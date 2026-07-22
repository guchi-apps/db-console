import type { Pool } from "mysql2/promise";

// MariaDB識別子として安全に許可する文字のみ（バッククォート・ドット・空白・SQLコメント記号等は一切許可しない）。
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;

export class InvalidIdentifierError extends Error {
  constructor(kind: string, value: string) {
    super(`不正な${kind}です: ${value}`);
    this.name = "InvalidIdentifierError";
  }
}

export class IdentifierNotFoundError extends Error {
  constructor(kind: string, value: string) {
    super(`${kind}が見つかりません: ${value}`);
    this.name = "IdentifierNotFoundError";
  }
}

/** DB名・テーブル名・カラム名・インデックス名に共通の文字種チェック。 */
function assertSafeIdentifierName(kind: string, name: string): void {
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw new InvalidIdentifierError(kind, name);
  }
}

export function assertSafeDatabaseName(name: string): void {
  assertSafeIdentifierName("DB名", name);
}

export function assertSafeTableName(name: string): void {
  assertSafeIdentifierName("テーブル名", name);
}

export function assertSafeColumnName(name: string): void {
  assertSafeIdentifierName("カラム名", name);
}

export function assertSafeIndexName(name: string): void {
  assertSafeIdentifierName("インデックス名", name);
}

/** 文字種チェック済みの識別子をバッククォートで囲む。呼び出し前に必ず assertSafe* を通すこと。 */
export function quoteIdentifier(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

/** `db`.`table` 形式の完全修飾テーブル名を組み立てる（両方の文字種チェックを行った上で）。 */
export function qualifyTable(databaseName: string, tableName: string): string {
  assertSafeDatabaseName(databaseName);
  assertSafeTableName(tableName);
  return `${quoteIdentifier(databaseName)}.${quoteIdentifier(tableName)}`;
}

/** `db`.`table`.`column` ではなく、`column` 部分のみをクォートして返す（SELECT句等で使用）。 */
export function quoteColumn(columnName: string): string {
  assertSafeColumnName(columnName);
  return quoteIdentifier(columnName);
}

/** information_schema に対して実在確認を行う。SELECTのみで完結するため data-write 権限で実行できる。 */
export async function assertTableExists(
  pool: Pool,
  databaseName: string,
  tableName: string,
): Promise<void> {
  assertSafeDatabaseName(databaseName);
  assertSafeTableName(tableName);

  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ? LIMIT 1`,
    [databaseName, tableName],
  );
  if ((rows as unknown[]).length === 0) {
    throw new IdentifierNotFoundError("テーブル", `${databaseName}.${tableName}`);
  }
}

export async function assertColumnExists(
  pool: Pool,
  databaseName: string,
  tableName: string,
  columnName: string,
): Promise<void> {
  assertSafeDatabaseName(databaseName);
  assertSafeTableName(tableName);
  assertSafeColumnName(columnName);

  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ? AND column_name = ? LIMIT 1`,
    [databaseName, tableName, columnName],
  );
  if ((rows as unknown[]).length === 0) {
    throw new IdentifierNotFoundError(
      "カラム",
      `${databaseName}.${tableName}.${columnName}`,
    );
  }
}
