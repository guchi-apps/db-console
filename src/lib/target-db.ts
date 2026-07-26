import mysql, { type Pool } from "mysql2/promise";

import { getDatabaseEntry, modeAtLeast, type DatabaseMode } from "@/lib/config";

// 管理対象DB（asset-manager, car-care, wordpress 等）への接続専用プール。
// db-console 自身のメタデータDB（app_db_console）は lib/db.ts の Prisma 経由でアクセスする。
//
// max_connections=50 をVPS上の全アプリで共有しているため、プールは小さく保つ。
// database を固定せず、常に完全修飾テーブル名（lib/identifier.ts の qualifyTable）で
// クエリを組み立てることで、プールされたコネクション間で `USE` によるセッション状態を
// 持ち回さない設計にしている。

let dataPool: Pool | null = null;
let schemaPool: Pool | null = null;

function createPool(user: string, password: string): Pool {
  return mysql.createPool({
    // TARGET_DB_HOST/PORT は、ローカル開発からSSHトンネル経由で本番データを
    // 参照する場合など、管理対象DBの接続先がdb-console自身のメタデータDB（DB_HOST/DB_PORT）
    // と異なるときにだけ設定する。本番環境では同一MariaDBインスタンスのため未設定でよい。
    host: process.env.TARGET_DB_HOST ?? process.env.DB_HOST,
    port: Number(process.env.TARGET_DB_PORT ?? process.env.DB_PORT ?? 3306),
    user,
    password,
    connectionLimit: 5,
    maxIdle: 2,
    idleTimeout: 30_000,
    namedPlaceholders: false,
  });
}

/** レコードの閲覧・追加・更新・削除に使う通常操作用ロール（db_console_data）。 */
export function getDataPool(): Pool {
  if (!dataPool) {
    dataPool = createPool(
      process.env.DB_CONSOLE_DATA_USER!,
      process.env.DB_CONSOLE_DATA_PASSWORD!,
    );
  }
  return dataPool;
}

/** テーブル・カラム・インデックスのDDL操作に使う構造変更用ロール（db_console_schema）。 */
export function getSchemaPool(): Pool {
  if (!schemaPool) {
    schemaPool = createPool(
      process.env.DB_CONSOLE_SCHEMA_USER!,
      process.env.DB_CONSOLE_SCHEMA_PASSWORD!,
    );
  }
  return schemaPool;
}

export class DatabaseNotAllowedError extends Error {
  constructor(databaseName: string) {
    super(`許可されていないDBです: ${databaseName}`);
    this.name = "DatabaseNotAllowedError";
  }
}

export class ModeNotAllowedError extends Error {
  constructor(databaseName: string, required: DatabaseMode) {
    super(`${databaseName} では ${required} 操作が許可されていません`);
    this.name = "ModeNotAllowedError";
  }
}

/**
 * 呼び出し側の操作に必要な最小モードを渡し、許可リスト判定・操作モード判定を行った上で
 * 適切なロールのプールを返す。この関数を経由せずに getDataPool/getSchemaPool を直接
 * 呼ぶAPIルートを作らないこと（認可チェックの抜け漏れを防ぐため）。
 */
export async function getPoolForOperation(
  databaseName: string,
  requiredMode: DatabaseMode,
): Promise<Pool> {
  const entry = await getDatabaseEntry(databaseName);
  if (!entry) {
    throw new DatabaseNotAllowedError(databaseName);
  }
  if (!modeAtLeast(entry.mode, requiredMode)) {
    throw new ModeNotAllowedError(databaseName, requiredMode);
  }
  return requiredMode === "schema-write" ? getSchemaPool() : getDataPool();
}
