import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/allowed-emails";
import { sanitizeReturnTo } from "@/lib/return-to";
import { getRequestOrigin } from "@/lib/request-origin";
import { db } from "@/lib/db";
import { isSessionExpired } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Supabase の Google OAuth コールバック。
 * 通常ログインと `/reauth`（?reauth=1）からの再認証完了の両方をここで受ける。
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = await getRequestOrigin();
  const code = searchParams.get("code");
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const isReauth = searchParams.get("reauth") === "1";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();

  // 再認証は新しいSupabaseセッション（新しい session_id）を発行し、Cookieを差し替える。
  // 8時間の絶対タイムアウトの起点（loginAt）を引き継ぐため、差し替える前に再認証前の
  // セッションを控えておく（#133）。
  const previous = isReauth ? await readCurrentSession(supabase) : null;

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

  // 再認証は「今ログインしている本人」であることの確認なので、再認証前のセッションが
  // 有効で、かつ同じユーザーでなければ成立させない。`prompt: select_account` のため
  // 別のアカウントを選べるうえ、引き継ぐ loginAt が無ければタイムアウトの起点も決められない。
  if (isReauth && (!previous || previous.supabaseUserId !== claims.sub)) {
    await supabase.auth.signOut();
    const reason = previous ? "reauth_account_mismatch" : "reauth_session_expired";
    return NextResponse.redirect(`${origin}/login?error=${reason}`);
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
      // 再認証では再認証前のセッションの loginAt を引き継ぎ、絶対タイムアウトを延ばさない。
      loginAt: previous?.loginAt ?? now,
      lastActivityAt: now,
      reauthVerifiedAt: isReauth ? now : null,
    },
  });

  return NextResponse.redirect(`${origin}${returnTo}`);
}

type PreviousSession = { supabaseUserId: string; loginAt: Date };

/**
 * Cookieに載っている現在のセッションを読む。db-console側に記録が無い・8時間を過ぎている
 * ものは「有効なセッションではない」としてnullを返す（`getSession()` と同じ基準）。
 */
async function readCurrentSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<PreviousSession | null> {
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.session_id) return null;

  const appSession = await db.appSession.findUnique({
    where: { supabaseSessionId: claims.session_id },
  });
  if (!appSession || isSessionExpired(appSession.loginAt)) return null;

  return { supabaseUserId: claims.sub, loginAt: appSession.loginAt };
}
