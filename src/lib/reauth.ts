import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";

const REAUTH_VALID_MS = 5 * 60 * 1000; // 5分（issue #1 の推奨値）

/** 直近5分以内に再認証（Google再ログイン）が完了しているセッションかどうか。 */
export async function isReauthValid(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sessionId = data?.claims?.session_id;
  if (!sessionId) return false;

  const appSession = await db.appSession.findUnique({ where: { supabaseSessionId: sessionId } });
  if (!appSession?.reauthVerifiedAt) return false;

  return Date.now() - appSession.reauthVerifiedAt.getTime() < REAUTH_VALID_MS;
}
