import { randomBytes } from "node:crypto";

import type { RowDataPacket } from "mysql2/promise";

import { getAdminPool } from "@/lib/admin-db";
import { MANAGED_NAME_PREFIX, assertManagedName } from "@/lib/config";
import {
  InvalidIdentifierError,
  assertSafeDatabaseName,
  fromDatabaseGrantPattern,
  quoteIdentifier,
  toDatabaseGrantPattern,
} from "@/lib/identifier";

// アプリ用DBユーザー（app_ で始まるアカウント）の一覧・作成・削除・権限変更。
// 実行にはすべて管理ロール（lib/admin-db.ts）を使う。
//
// パスワードはこのアプリでは一切保存しない。作成・再発行の直後に画面で1度だけ表示し、
// 以降は再発行するしかない（監査ログにも残さない）。

/** MySQL/MariaDB のユーザー名の最大長は 32 文字（MariaDBは80だが短い方に合わせる）。 */
const MAX_USER_NAME_LENGTH = 32;

const USER_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

/** 発行するパスワードの長さ（英数字のみ）。 */
const PASSWORD_LENGTH = 32;

/** 作成時に選べる接続元ホスト。VPS上のアプリからの接続を想定した3種類に限定する。 */
export const USER_HOSTS = ["localhost", "127.0.0.1", "%"] as const;
export type UserHost = (typeof USER_HOSTS)[number];

export const USER_HOST_LABELS: Record<UserHost, string> = {
  localhost: "localhost（同一サーバー内・ソケット/名前解決）",
  "127.0.0.1": "127.0.0.1（同一サーバー内・TCP）",
  "%": "%（どこからでも）",
};

export type PrivilegePreset = "none" | "read-only" | "read-write" | "full";

export const PRIVILEGE_PRESETS: PrivilegePreset[] = ["none", "read-only", "read-write", "full"];

export const PRIVILEGE_PRESET_LABELS: Record<PrivilegePreset | "custom", string> = {
  none: "権限なし",
  "read-only": "閲覧のみ",
  "read-write": "読み書き",
  full: "フル（構造変更込み）",
  custom: "カスタム（画面外で設定された権限）",
};

/**
 * プリセットごとに付与する権限。GRANT OPTION は含めない（管理ロール以外に権限を配らせない）。
 * MySQL 8 と MariaDB 10.11 の双方に存在する権限だけで構成している。
 */
const PRESET_PRIVILEGES: Record<Exclude<PrivilegePreset, "none">, string[]> = {
  "read-only": ["SELECT", "SHOW VIEW"],
  "read-write": ["SELECT", "INSERT", "UPDATE", "DELETE", "SHOW VIEW", "EXECUTE"],
  full: [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "CREATE",
    "DROP",
    "ALTER",
    "INDEX",
    "REFERENCES",
    "CREATE TEMPORARY TABLES",
    "LOCK TABLES",
    "CREATE VIEW",
    "SHOW VIEW",
    "CREATE ROUTINE",
    "ALTER ROUTINE",
    "EXECUTE",
    "TRIGGER",
    "EVENT",
  ],
};

export function privilegesForPreset(preset: PrivilegePreset): string[] {
  return preset === "none" ? [] : PRESET_PRIVILEGES[preset];
}

/** mysql.db の *_priv カラムと権限名の対応（MySQL 8 / MariaDB 10.11 の共通部分のみ）。 */
const PRIVILEGE_COLUMNS: Record<string, string> = {
  Select_priv: "SELECT",
  Insert_priv: "INSERT",
  Update_priv: "UPDATE",
  Delete_priv: "DELETE",
  Create_priv: "CREATE",
  Drop_priv: "DROP",
  Grant_priv: "GRANT OPTION",
  References_priv: "REFERENCES",
  Index_priv: "INDEX",
  Alter_priv: "ALTER",
  Create_tmp_table_priv: "CREATE TEMPORARY TABLES",
  Lock_tables_priv: "LOCK TABLES",
  Create_view_priv: "CREATE VIEW",
  Show_view_priv: "SHOW VIEW",
  Create_routine_priv: "CREATE ROUTINE",
  Alter_routine_priv: "ALTER ROUTINE",
  Execute_priv: "EXECUTE",
  Event_priv: "EVENT",
  Trigger_priv: "TRIGGER",
};

const PRIVILEGE_COLUMN_NAMES = Object.keys(PRIVILEGE_COLUMNS);

/** mysql.db の1行から、付与されている権限名の一覧を取り出す。 */
export function privilegesFromRow(row: Record<string, unknown>): string[] {
  return PRIVILEGE_COLUMN_NAMES.filter(
    (column) => String(row[column] ?? "N").toUpperCase() === "Y",
  ).map((column) => PRIVILEGE_COLUMNS[column]);
}

/** 付与済み権限の集合が、どのプリセットと一致するかを判定する（一致しなければ custom）。 */
export function matchPreset(privileges: string[]): PrivilegePreset | "custom" {
  if (privileges.length === 0) return "none";
  const actual = new Set(privileges);
  for (const preset of ["read-only", "read-write", "full"] as const) {
    const expected = PRESET_PRIVILEGES[preset];
    if (expected.length === actual.size && expected.every((name) => actual.has(name))) {
      return preset;
    }
  }
  return "custom";
}

export function assertSafeUserName(name: string): void {
  if (!USER_NAME_PATTERN.test(name) || name.length > MAX_USER_NAME_LENGTH) {
    throw new InvalidIdentifierError("ユーザー名", name);
  }
  assertManagedName("ユーザー名", name);
}

export function assertSafeUserHost(host: string): asserts host is UserHost {
  if (!(USER_HOSTS as readonly string[]).includes(host)) {
    throw new InvalidIdentifierError("接続元ホスト", host);
  }
}

/** 英数字のみ32文字のパスワードを生成する（.env へ貼り付けても壊れない文字種に限定）。 */
export function generatePassword(): string {
  // base64url から記号（- と _）を落とすため、32文字に足りるまで継ぎ足してから切り出す。
  let generated = "";
  while (generated.length < PASSWORD_LENGTH) {
    generated += randomBytes(48).toString("base64url").replace(/[-_]/g, "");
  }
  return generated.slice(0, PASSWORD_LENGTH);
}

export interface UserGrant {
  database: string;
  privileges: string[];
  preset: PrivilegePreset | "custom";
}

export interface DatabaseUserAccount {
  user: string;
  host: string;
  grants: UserGrant[];
}

/**
 * app_ で始まるDBユーザーを、DB単位の権限つきで列挙する。
 * mysql.db の Db カラムはGRANTパターン（`app\_car` のようにエスケープされた形）で入っているため、
 * DB名へ戻してから返す。`app\_%` のように複数DBへ掛かる指定はDB名に戻せないので、
 * パターンのまま「対象外の権限」として扱う。
 */
export async function listDatabaseUsers(): Promise<DatabaseUserAccount[]> {
  const pool = getAdminPool();
  const namePattern = `${MANAGED_NAME_PREFIX.replace(/_/g, "\\_")}%`;

  const [userRows] = await pool.query<RowDataPacket[]>(
    "SELECT User AS user, Host AS host FROM mysql.user WHERE User LIKE ? ORDER BY User, Host",
    [namePattern],
  );

  const [grantRows] = await pool.query<RowDataPacket[]>(
    `SELECT User AS user, Host AS host, Db AS db, ${PRIVILEGE_COLUMN_NAMES.join(", ")}
     FROM mysql.db WHERE User LIKE ? ORDER BY Db`,
    [namePattern],
  );

  return userRows.map((row) => {
    const user = String(row.user);
    const host = String(row.host);
    const grants = grantRows
      .filter((grant) => String(grant.user) === user && String(grant.host) === host)
      .map((grant) => {
        const privileges = privilegesFromRow(grant as Record<string, unknown>);
        const pattern = String(grant.db);
        // 複数DBに掛かるワイルドカード指定は特定のDB名へ戻せないため、パターンのまま表示する。
        const database = fromDatabaseGrantPattern(pattern) ?? pattern;
        return { database, privileges, preset: matchPreset(privileges) };
      });
    return { user, host, grants };
  });
}

/** プリセットの強さ（権限を弱める変更かどうかの判定に使う）。custom は最強として扱う。 */
export const PRESET_RANK: Record<PrivilegePreset | "custom", number> = {
  none: 0,
  "read-only": 1,
  "read-write": 2,
  full: 3,
  custom: 3,
};

/** 特定ユーザーの、特定DBに対する現在の権限を取得する。 */
export async function getDatabaseUserGrant(
  user: string,
  host: string,
  databaseName: string,
): Promise<UserGrant> {
  assertSafeUserName(user);
  assertSafeUserHost(host);
  assertSafeDatabaseName(databaseName);

  const [rows] = await getAdminPool().query<RowDataPacket[]>(
    `SELECT ${PRIVILEGE_COLUMN_NAMES.join(", ")} FROM mysql.db
     WHERE User = ? AND Host = ? AND Db = ? LIMIT 1`,
    [user, host, toDatabaseGrantPattern(databaseName)],
  );
  const privileges = rows[0] ? privilegesFromRow(rows[0] as Record<string, unknown>) : [];
  return { database: databaseName, privileges, preset: matchPreset(privileges) };
}

export async function createDatabaseUser(
  user: string,
  host: string,
): Promise<{ password: string }> {
  assertSafeUserName(user);
  assertSafeUserHost(host);

  const password = generatePassword();
  await getAdminPool().query("CREATE USER ?@? IDENTIFIED BY ?", [user, host, password]);
  return { password };
}

export async function resetDatabaseUserPassword(
  user: string,
  host: string,
): Promise<{ password: string }> {
  assertSafeUserName(user);
  assertSafeUserHost(host);

  const password = generatePassword();
  await getAdminPool().query("ALTER USER ?@? IDENTIFIED BY ?", [user, host, password]);
  return { password };
}

export async function dropDatabaseUser(user: string, host: string): Promise<void> {
  assertSafeUserName(user);
  assertSafeUserHost(host);

  await getAdminPool().query("DROP USER ?@?", [user, host]);
}

/**
 * 対象DBに対する権限をプリセットで置き換える（既存の権限は一度すべて剥がしてから付け直す）。
 * 対象DBは管理対象として登録済みであることを呼び出し側で確認すること。
 */
export async function setDatabaseUserPrivilege(
  user: string,
  host: string,
  databaseName: string,
  preset: PrivilegePreset,
): Promise<void> {
  assertSafeUserName(user);
  assertSafeUserHost(host);
  assertSafeDatabaseName(databaseName);

  const pool = getAdminPool();
  // 対象DBだけに一致するパターンでGRANT/REVOKEする（理由は toDatabaseGrantPattern のコメント）。
  const target = `${quoteIdentifier(toDatabaseGrantPattern(databaseName))}.*`;

  try {
    await pool.query(`REVOKE ALL PRIVILEGES ON ${target} FROM ?@?`, [user, host]);
  } catch (error) {
    // そのDBに権限が1つも無い状態での REVOKE は ER_NONEXISTING_GRANT になる。
    // 「権限なし」へ揃えたいだけなので、この場合は成功として扱う。
    if ((error as { code?: string }).code !== "ER_NONEXISTING_GRANT") {
      throw error;
    }
  }

  const privileges = privilegesForPreset(preset);
  if (privileges.length > 0) {
    await pool.query(`GRANT ${privileges.join(", ")} ON ${target} TO ?@?`, [user, host]);
  }
}
