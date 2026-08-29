import type { Pool, RowDataPacket } from "mysql2/promise";

import {
  FORBIDDEN_DATABASE_NAMES,
  MANAGED_NAME_PREFIX,
  assertManagedName,
  type DatabaseMode,
} from "@/lib/config";
import {
  assertSafeDatabaseName,
  quoteIdentifier,
  toDatabaseGrantPattern,
} from "@/lib/identifier";
import { createTargetPool } from "@/lib/target-db";

// DBの新規作成・DBユーザーの発行と権限変更にだけ使う管理ロール（db_console_admin）専用のプール。
//
// このロールは `app\_%` に対する GRANT OPTION 付きの権限とグローバルの CREATE USER を持つため、
// data/schema の2ロールより明確に強い。**このモジュール以外から getAdminPool() を呼ばないこと。**
// 特に SQL実行画面（/databases/[db]/sql）は getPoolForOperation() 経由の data/schema プールしか
// 使わないため、画面から任意のGRANT文を流す経路は存在しない、という前提を壊さないこと。
//
// 未設定（環境変数なし）の環境でも画面自体は開けるようにし、操作だけを止める。

let adminPool: Pool | null = null;

export class AdminRoleNotConfiguredError extends Error {
  constructor() {
    super(
      "管理ロール（DB_CONSOLE_ADMIN_USER / DB_CONSOLE_ADMIN_PASSWORD）が設定されていません",
    );
    this.name = "AdminRoleNotConfiguredError";
  }
}

export function isAdminRoleConfigured(): boolean {
  return Boolean(process.env.DB_CONSOLE_ADMIN_USER && process.env.DB_CONSOLE_ADMIN_PASSWORD);
}

export function getAdminPool(): Pool {
  if (!isAdminRoleConfigured()) {
    throw new AdminRoleNotConfiguredError();
  }
  if (!adminPool) {
    adminPool = createTargetPool(
      process.env.DB_CONSOLE_ADMIN_USER!,
      process.env.DB_CONSOLE_ADMIN_PASSWORD!,
    );
  }
  return adminPool;
}

/**
 * 新しく作ったDBに対して、閲覧・編集用ロール（db_console_data）へ付与する権限。
 * SHOW VIEW はビュー定義の表示（information_schema.views.view_definition）に必要（#86）。
 */
const DATA_ROLE_PRIVILEGES: Record<DatabaseMode, string[]> = {
  "read-only": ["SELECT", "SHOW VIEW"],
  "data-write": ["SELECT", "INSERT", "UPDATE", "DELETE", "SHOW VIEW"],
  "schema-write": ["SELECT", "INSERT", "UPDATE", "DELETE", "SHOW VIEW"],
};

/** 構造変更用ロール（db_console_schema）へ付与する権限。schema-write のDBにだけ付ける。 */
const SCHEMA_ROLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "CREATE",
  "ALTER",
  "DROP",
  "INDEX",
  "SHOW VIEW",
];

export class DatabaseAlreadyExistsError extends Error {
  constructor(name: string) {
    super(`${name} は既にMariaDB上に存在します`);
    this.name = "DatabaseAlreadyExistsError";
  }
}

export class RoleAccountNotFoundError extends Error {
  constructor(user: string) {
    super(`MariaDB上に ${user} アカウントが見つかりません`);
    this.name = "RoleAccountNotFoundError";
  }
}

/** 指定ユーザー名のアカウントが存在するホストを列挙する（同名で複数ホストに存在しうるため）。 */
async function listAccountHosts(pool: Pool, user: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT Host AS host FROM mysql.user WHERE User = ?",
    [user],
  );
  return rows.map((row) => String(row.host));
}

// GRANT直後、data/schemaプールの**既存コネクションでも**新しいDBが見えるかを実測した（#91・
// 計画レビューG1の指摘1）。MySQL 8.0.46 で、GRANT前から張っていたコネクションが
// information_schema.schemata に新DBを返し、追加したCREATE権限でそのままCREATE TABLEできた。
// DBレベル権限がセッションにキャッシュされるのは `USE` で選んだカレントDBについてで、
// このアプリは `USE` を発行せず既定DBも持たない（target-db.ts の設計）ため、
// 完全修飾名でのアクセスは毎回ACLを引き直す。したがってプールの張り直しは不要。
async function grantToRole(
  pool: Pool,
  user: string,
  privileges: string[],
  databaseName: string,
): Promise<string[]> {
  const hosts = await listAccountHosts(pool, user);
  if (hosts.length === 0) {
    throw new RoleAccountNotFoundError(user);
  }
  // 対象DBだけに一致するパターンでGRANTする（理由は toDatabaseGrantPattern のコメント）。
  const target = `${quoteIdentifier(toDatabaseGrantPattern(databaseName))}.*`;
  for (const host of hosts) {
    await pool.query(`GRANT ${privileges.join(", ")} ON ${target} TO ?@?`, [user, host]);
  }
  return hosts.map((host) => `${user}@${host}`);
}

/**
 * 指定したDBを、操作モードに応じて閲覧・編集用（と必要なら構造変更用）ロールへ
 * GRANT する。DBの新規作成（createDatabase）と、app_ で始まる既存DBの自動登録
 * （managed-db-sync.ts・#97）の両方から呼ぶ。
 * GRANT は冪等なので、既に権限を持つDBへ再実行しても問題ない。
 */
export async function grantDatabaseToRoles(
  name: string,
  mode: DatabaseMode,
): Promise<string[]> {
  assertSafeDatabaseName(name);
  assertManagedName("DB名", name);

  const pool = getAdminPool();
  const grantedAccounts = await grantToRole(
    pool,
    process.env.DB_CONSOLE_DATA_USER!,
    DATA_ROLE_PRIVILEGES[mode],
    name,
  );

  if (mode === "schema-write") {
    grantedAccounts.push(
      ...(await grantToRole(pool, process.env.DB_CONSOLE_SCHEMA_USER!, SCHEMA_ROLE_PRIVILEGES, name)),
    );
  }

  return grantedAccounts;
}

/**
 * MariaDB上に実在する app_ で始まるDB名を列挙する（#97）。
 * data/schema ロールの information_schema.schemata はGRANT済みのDBしか返さないため、
 * 「まだGRANTしていない app_ のDB」を見つけるには `app\_%` へのGRANT OPTIONを持つ
 * 管理ロールで引く必要がある。`_` はLIKEのワイルドカードなのでエスケープする。
 */
export async function listExistingManagedDatabaseNames(): Promise<string[]> {
  const pool = getAdminPool();
  const likePattern = `${MANAGED_NAME_PREFIX.replace(/_/g, "\\_")}%`;

  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT schema_name AS schema_name FROM information_schema.schemata WHERE schema_name LIKE ? ORDER BY schema_name",
    [likePattern],
  );

  return rows
    .map((row) => String(row.schema_name))
    .filter((name) => !FORBIDDEN_DATABASE_NAMES.has(name));
}

export interface CreateDatabaseResult {
  /** 実際に権限を付与したアカウント（例: db_console_data@localhost）。 */
  grantedAccounts: string[];
}

/**
 * MariaDB上にDBを新規作成し、閲覧・編集用（と必要なら構造変更用）ロールへ権限を付与する。
 * 作成できるのは app_ で始まる名前だけで、システムDBの名前は config.ts 側でも弾いている。
 */
export async function createDatabase(
  name: string,
  mode: DatabaseMode,
): Promise<CreateDatabaseResult> {
  assertSafeDatabaseName(name);
  assertManagedName("DB名", name);
  if (FORBIDDEN_DATABASE_NAMES.has(name)) {
    throw new Error(`システムDBは作成できません: ${name}`);
  }

  const pool = getAdminPool();

  const [existing] = await pool.query<RowDataPacket[]>(
    "SELECT 1 FROM information_schema.schemata WHERE schema_name = ? LIMIT 1",
    [name],
  );
  if (existing.length > 0) {
    throw new DatabaseAlreadyExistsError(name);
  }

  await pool.query(
    `CREATE DATABASE ${quoteIdentifier(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );

  return { grantedAccounts: await grantDatabaseToRoles(name, mode) };
}
