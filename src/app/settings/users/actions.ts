"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUserId } from "@/lib/session";
import { getDatabaseEntry, isManagedName } from "@/lib/config";
import { isReauthValid } from "@/lib/reauth";
import { writeAuditLogSafely } from "@/lib/audit";
import {
  PRESET_RANK,
  PRIVILEGE_PRESETS,
  createDatabaseUser,
  dropDatabaseUser,
  getDatabaseUserGrant,
  resetDatabaseUserPassword,
  setDatabaseUserPrivilege,
  type PrivilegePreset,
} from "@/lib/db-users";

const USERS_PATH = "/settings/users";

// ユーザー単位の操作には対象DBが無いため、監査ログの databaseName は空文字にし、
// 対象アカウント（user@host）を objectName に記録する。
const NO_DATABASE = "";

export interface DbUserActionState {
  error?: string;
  /** 作成・再発行の直後に1度だけ画面へ返すパスワード（保存も監査ログへの記録もしない）。 */
  password?: string;
  account?: string;
}

function redirectWithError(message: string): never {
  redirect(`${USERS_PATH}?error=${encodeURIComponent(message)}`);
}

function requireReauth(): void {
  redirect(`/reauth?returnTo=${encodeURIComponent(USERS_PATH)}`);
}

export async function createDatabaseUserAction(
  _prevState: DbUserActionState,
  formData: FormData,
): Promise<DbUserActionState> {
  const userId = await requireUserId();
  const name = String(formData.get("name") ?? "").trim();
  const host = String(formData.get("host") ?? "").trim();
  const account = `${name}@${host}`;

  // 監査ログは操作の結果が確定したあとに、try の外で書く。ここで落ちても、作成済みの
  // ユーザーのパスワード（保存しておらず、この1回しか返せない）を返せなくならないようにする（#143）。
  let password: string;
  try {
    ({ password } = await createDatabaseUser(name, host));
  } catch (error) {
    const message = error instanceof Error ? error.message : "ユーザーの作成に失敗しました";
    await writeAuditLogSafely({
      userId,
      action: "DB_USER_CREATE",
      databaseName: NO_DATABASE,
      objectName: account,
      status: "FAILURE",
      errorMessage: message,
    });
    return { error: message };
  }

  await writeAuditLogSafely({
    userId,
    action: "DB_USER_CREATE",
    databaseName: NO_DATABASE,
    objectName: account,
    status: "SUCCESS",
  });
  revalidatePath(USERS_PATH);
  return { password, account };
}

export async function resetDatabaseUserPasswordAction(
  _prevState: DbUserActionState,
  formData: FormData,
): Promise<DbUserActionState> {
  const userId = await requireUserId();
  const name = String(formData.get("name") ?? "");
  const host = String(formData.get("host") ?? "");
  const account = `${name}@${host}`;

  // 既存のパスワードが即座に無効になり、そのユーザーを使うアプリが接続できなくなる。
  if (!(await isReauthValid())) {
    requireReauth();
  }

  let password: string;
  try {
    ({ password } = await resetDatabaseUserPassword(name, host));
  } catch (error) {
    const message = error instanceof Error ? error.message : "パスワードの再発行に失敗しました";
    await writeAuditLogSafely({
      userId,
      action: "DB_USER_PASSWORD_RESET",
      databaseName: NO_DATABASE,
      objectName: account,
      status: "FAILURE",
      errorMessage: message,
    });
    return { error: message };
  }

  await writeAuditLogSafely({
    userId,
    action: "DB_USER_PASSWORD_RESET",
    databaseName: NO_DATABASE,
    objectName: account,
    status: "SUCCESS",
  });
  return { password, account };
}

export async function dropDatabaseUserAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const name = String(formData.get("name") ?? "");
  const host = String(formData.get("host") ?? "");
  const account = `${name}@${host}`;

  if (!(await isReauthValid())) {
    requireReauth();
  }

  try {
    await dropDatabaseUser(name, host);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ユーザーの削除に失敗しました";
    await writeAuditLogSafely({
      userId,
      action: "DB_USER_DROP",
      databaseName: NO_DATABASE,
      objectName: account,
      status: "FAILURE",
      errorMessage: message,
    });
    redirectWithError(message);
  }

  await writeAuditLogSafely({
    userId,
    action: "DB_USER_DROP",
    databaseName: NO_DATABASE,
    objectName: account,
    status: "SUCCESS",
  });

  revalidatePath(USERS_PATH);
  redirect(USERS_PATH);
}

export async function updateDatabaseUserPrivilegeAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const name = String(formData.get("name") ?? "");
  const host = String(formData.get("host") ?? "");
  const databaseName = String(formData.get("database") ?? "");
  const preset = String(formData.get("preset") ?? "") as PrivilegePreset;
  const account = `${name}@${host}`;

  if (!PRIVILEGE_PRESETS.includes(preset)) {
    redirectWithError(`不正な権限の指定です: ${preset}`);
  }
  // 管理対象として登録済みで、かつ app_ で始まるDBだけを権限変更の対象にする
  // （管理ロールが GRANT できるのも `app\_%` に限られている）。
  if (!isManagedName(databaseName) || !(await getDatabaseEntry(databaseName))) {
    redirectWithError(`権限を変更できないDBです: ${databaseName}`);
  }

  let current: Awaited<ReturnType<typeof getDatabaseUserGrant>>;
  try {
    current = await getDatabaseUserGrant(name, host, databaseName);
    // 権限を弱める変更は、そのユーザーを使うアプリが動かなくなるため再認証を求める。
    if (PRESET_RANK[preset] < PRESET_RANK[current.preset] && !(await isReauthValid())) {
      requireReauth();
    }

    await setDatabaseUserPrivilege(name, host, databaseName, preset);
  } catch (error) {
    // requireReauth() の redirect を握りつぶさないよう、Next.jsの制御用エラーは素通しする。
    if (isRedirectError(error)) throw error;
    const message = error instanceof Error ? error.message : "権限の変更に失敗しました";
    await writeAuditLogSafely({
      userId,
      action: "DB_USER_GRANT",
      databaseName,
      objectName: account,
      status: "FAILURE",
      errorMessage: message,
    });
    redirectWithError(message);
  }

  await writeAuditLogSafely({
    userId,
    action: "DB_USER_GRANT",
    databaseName,
    objectName: account,
    beforeData: { preset: current.preset, privileges: current.privileges },
    afterData: { preset },
    status: "SUCCESS",
  });

  revalidatePath(USERS_PATH);
  redirect(USERS_PATH);
}

/** redirect()/notFound() が投げる Next.js 内部エラーかどうか。 */
function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
