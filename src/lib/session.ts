import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/allowed-emails";
import { db } from "@/lib/db";

const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8時間（issue #1の推奨値）

export type Session = {
  user: {
    id: string;
    email: string;
    name: string | null;
    image: string | null;
  };
  supabaseSessionId: string;
};

/** 現在のセッションを取得する（未認証ならnull、リダイレクトしない）。 */
export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  // 未ログイン、またはログイン後に許可リストから外れた場合は未認証扱いにする
  // （issue #2: 許可されたユーザー以外をAPI側でも拒否する）。
  if (!claims?.email || !isEmailAllowed(claims.email)) return null;

  const appSession = await db.appSession.findUnique({
    where: { supabaseSessionId: claims.session_id },
    include: { user: true },
  });
  // /auth/callback を経由していない（＝db-console側の記録がない）セッションは未認証扱い。
  if (!appSession) return null;
  // 8時間の絶対タイムアウト（issue #1の推奨値）。
  if (Date.now() - appSession.loginAt.getTime() > SESSION_MAX_AGE_MS) return null;

  return {
    user: {
      id: appSession.user.id,
      email: appSession.user.email,
      name: appSession.user.name,
      image: appSession.user.image,
    },
    supabaseSessionId: appSession.supabaseSessionId,
  };
}

/** ページ（Server Component）用。未認証なら /login へリダイレクトする。 */
export async function requireSessionForPage(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

/** APIルート用。未認証なら401を返す（呼び出し側で return してレスポンスとして使う）。 */
export async function requireSessionForApi(): Promise<
  { session: Session; response?: undefined } | { session?: undefined; response: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return {
      response: NextResponse.json({ error: "認証が必要です" }, { status: 401 }),
    };
  }
  return { session };
}

/** Server Action 用。未認証なら Error を投げる（呼び出し側で catch する）。 */
export async function requireUserId(): Promise<string> {
  const session = await getSession();
  if (!session) {
    throw new Error("認証が必要です");
  }
  return session.user.id;
}
