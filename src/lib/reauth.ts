import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";

const REAUTH_VALID_MS = 5 * 60 * 1000; // 5分（issue #1 の推奨値）

/** 再認証が有効な時間（分）。画面の説明文に出すため公開する。 */
export const REAUTH_VALID_MINUTES = REAUTH_VALID_MS / 60_000;

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

/** 再認証画面へのパス。確認後は returnTo の画面へ戻る。 */
export function reauthPath(returnTo: string): string {
  return `/reauth?returnTo=${encodeURIComponent(returnTo)}`;
}

/**
 * 構造変更（DDL）を実行する直前の関門（#105）。
 * 管理対象DBごとの操作モードを廃止し、構造を変える操作の側でだけ本人確認を求める方式に
 * したため、テーブル・カラム・インデックスを変えるサーバーアクションはすべて先頭でこれを呼ぶ。
 * 再認証が切れている場合は `/reauth` へリダイレクトし、以降の処理へは進まない。
 *
 * リダイレクトすると入力中のフォームは失われるため、画面側では
 * `SchemaChangeNotice`（src/components/schema-change-notice.tsx）で入力前に確認を促している。
 */
export async function assertSchemaChangeReauth(returnTo: string): Promise<void> {
  if (!(await isReauthValid())) {
    redirect(reauthPath(returnTo));
  }
}
