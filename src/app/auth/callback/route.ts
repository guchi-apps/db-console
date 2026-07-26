import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/allowed-emails";
import { sanitizeReturnTo } from "@/lib/return-to";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Supabase の Google OAuth コールバック。
 * 通常ログインと `/reauth`（?reauth=1）からの再認証完了の両方をここで受ける。
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const isReauth = searchParams.get("reauth") === "1";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
  }

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  // 許可リスト判定はログイン直後にも行う（issue #2: 許可されたユーザー以外を拒否する）。
  if (!claims?.email || !isEmailAllowed(claims.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=forbidden`);
  }

  const email = claims.email.toLowerCase();
  const name =
    (claims.user_metadata?.full_name as string | undefined) ??
    (claims.user_metadata?.name as string | undefined) ??
    null;
  const image = (claims.user_metadata?.avatar_url as string | undefined) ?? null;
  const now = new Date();

  const user = await db.user.upsert({
    where: { email },
    update: { supabaseUserId: claims.sub, name, image, lastLoginAt: now },
    create: { email, supabaseUserId: claims.sub, name, image, lastLoginAt: now },
  });

  await db.appSession.upsert({
    where: { supabaseSessionId: claims.session_id },
    update: { lastActivityAt: now, ...(isReauth ? { reauthVerifiedAt: now } : {}) },
    create: {
      supabaseSessionId: claims.session_id,
      userId: user.id,
      loginAt: now,
      lastActivityAt: now,
      reauthVerifiedAt: isReauth ? now : null,
    },
  });

  return NextResponse.redirect(`${origin}${returnTo}`);
}
