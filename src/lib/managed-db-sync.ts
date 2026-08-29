import { writeAuditLog } from "@/lib/audit";
import {
  createDatabaseEntry,
  isManagedName,
  listAllManagedDatabaseNames,
  type DatabaseEntry,
  type DatabaseMode,
} from "@/lib/config";
import {
  grantDatabaseToRoles,
  isAdminRoleConfigured,
  listExistingManagedDatabaseNames,
} from "@/lib/admin-db";

// app_ で始まるDBは「このコンソールが管理するDB」という位置づけなので、設定画面で1件ずつ
// 登録させず、DB一覧・設定画面を開いた時点で自動的に管理対象へ取り込む（#97）。
//
// 取り込みには GRANT が要る。data/schema ロールの information_schema.schemata は
// GRANT済みのDBしか返さないため、「まだGRANTしていない app_ のDB」は
// listRegistrableDatabaseNames() には出てこない。管理ロール（db_console_admin）で
// 列挙し、そのまま data ロールへ GRANT してから登録する。
//
// 管理ロールが未設定の環境（本番VPSは #91 の手作業Issueが済むまで未設定）では何もしない。
// 従来どおり設定画面の「既存DBを登録」から手で登録する。

/**
 * 自動登録時の操作モード。「DBを新規作成」フォームの既定と揃えてある。
 * 登録後は設定画面から変更できる（変更してもこの同期で戻されることはない）。
 */
export const AUTO_REGISTER_MODE: DatabaseMode = "data-write";

/** 自動登録の対象にしてよいDB名か（app_ で始まり、自身のメタデータDBではない）。 */
export function isAutoRegistrableDatabase(name: string): boolean {
  if (!isManagedName(name)) {
    return false;
  }
  // db-console 自身のメタデータDB（app_db_console）は管理対象に出さない。
  return name !== process.env.DB_NAME;
}

/**
 * MariaDB上の app_ で始まるDBのうち未登録のものを、GRANT したうえで管理対象へ登録する。
 * ページの描画から呼ぶため、失敗しても例外を投げず、登録できたぶんだけ反映する。
 * 未登録のDBが無ければ書き込みは一切発生しない。
 *
 * 設定画面から管理対象を外したDBは「除外中」の行として残るため、ここでは登録し直さない
 * （listAllManagedDatabaseNames() が除外中のものも返す）。
 */
export async function syncManagedAppDatabases(userId: string): Promise<DatabaseEntry[]> {
  if (!isAdminRoleConfigured()) {
    return [];
  }

  let candidates: string[];
  try {
    candidates = (await listExistingManagedDatabaseNames()).filter(isAutoRegistrableDatabase);
  } catch {
    // 管理ロールで接続できない・権限が足りないといった理由で列挙できなくても、画面は開けるようにする。
    return [];
  }
  if (candidates.length === 0) {
    return [];
  }

  const registered = new Set(await listAllManagedDatabaseNames());
  const added: DatabaseEntry[] = [];

  for (const name of candidates) {
    if (registered.has(name)) {
      continue;
    }
    try {
      const grantedAccounts = await grantDatabaseToRoles(name, AUTO_REGISTER_MODE);
      const entry = await createDatabaseEntry({ name, mode: AUTO_REGISTER_MODE });
      added.push(entry);
      await writeAuditLog({
        userId,
        action: "MANAGED_DB_CREATE",
        databaseName: name,
        afterData: { ...entry, grantedAccounts, auto: true },
        status: "SUCCESS",
      });
    } catch (error) {
      await writeAuditLog({
        userId,
        action: "MANAGED_DB_CREATE",
        databaseName: name,
        status: "FAILURE",
        errorMessage: error instanceof Error ? error.message : "自動登録に失敗しました",
      }).catch(() => {});
    }
  }

  return added;
}
