import { cookies } from "next/headers";

import { db } from "@/lib/db";

const REAUTH_VALID_MS = 5 * 60 * 1000; // 5分（issue #1 の推奨値）
const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"];

async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  for (const name of SESSION_COOKIE_NAMES) {
    const cookie = cookieStore.get(name);
    if (cookie) return cookie.value;
  }
  return null;
}

/** 直近5分以内に再認証（Google再ログイン）が完了しているセッションかどうか。 */
export async function isReauthValid(): Promise<boolean> {
  const token = await getSessionToken();
  if (!token) return false;

  const session = await db.session.findUnique({ where: { sessionToken: token } });
  if (!session?.reauthVerifiedAt) return false;

  return Date.now() - session.reauthVerifiedAt.getTime() < REAUTH_VALID_MS;
}

/** 現在のセッションを再認証済みとしてマークする（/reauth/complete からのみ呼ぶ）。 */
export async function markReauthVerified(): Promise<void> {
  const token = await getSessionToken();
  if (!token) {
    throw new Error("セッションが見つかりません");
  }
  await db.session.update({
    where: { sessionToken: token },
    data: { reauthVerifiedAt: new Date() },
  });
}

/** returnTo パラメータのオープンリダイレクト対策。自サイト内の相対パスのみ許可する。 */
export function sanitizeReturnTo(returnTo: string | undefined): string {
  if (!returnTo) return "/";
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) return "/";
  return returnTo;
}
