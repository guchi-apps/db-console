import { escape as sqlEscape, type ResultSetHeader, type RowDataPacket } from "mysql2";

import {
  assertColumnExists,
  assertSafeColumnName,
  assertSafeDatabaseName,
  assertSafeIndexName,
  assertSafeTableName,
  assertTableExists,
  qualifyTable,
  quoteColumn,
  quoteIdentifier,
} from "@/lib/identifier";
import { getPoolForOperation } from "@/lib/target-db";

export interface DatabaseInfo {
  name: string;
  defaultCharacterSet: string | null;
  defaultCollation: string | null;
}

export interface TableSummary {
  name: string;
  engine: string | null;
  approximateRowCount: number | null;
  comment: string | null;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  columnType: string;
  isNullable: boolean;
  columnDefault: string | null;
  extra: string;
  columnKey: string;
  comment: string | null;
  ordinalPosition: number;
}

export interface IndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface ForeignKeyInfo {
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface RowsPage {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

/** 指定DBの文字コード・照合順序を取得する（information_schema.SCHEMATA）。 */
export async function getDatabaseInfo(databaseName: string): Promise<DatabaseInfo> {
  assertSafeDatabaseName(databaseName);
  const pool = await getPoolForOperation(databaseName, "read-only");

  // information_schema のカラムはMariaDB内部でUPPER CASE定義のため、明示的なASエイリアスで
  // 返却キーの大文字小文字を確定させる（エイリアスなしだとドライバがUPPER CASEのまま返す）。
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT default_character_set_name AS default_character_set_name,
            default_collation_name AS default_collation_name
     FROM information_schema.schemata
     WHERE schema_name = ? LIMIT 1`,
    [databaseName],
  );

  const row = rows[0];
  return {
    name: databaseName,
    defaultCharacterSet: (row?.default_character_set_name as string) ?? null,
    defaultCollation: (row?.default_collation_name as string) ?? null,
  };
}

/** 指定DB内の許可テーブル一覧を取得する（information_schema.TABLES）。 */
export async function listTables(databaseName: string): Promise<TableSummary[]> {
  assertSafeDatabaseName(databaseName);
  const pool = await getPoolForOperation(databaseName, "read-only");

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT table_name AS table_name, engine AS engine, table_rows AS table_rows,
            table_comment AS table_comment
     FROM information_schema.tables
     WHERE table_schema = ? AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [databaseName],
  );

  return rows.map((row) => ({
    name: row.table_name as string,
    engine: (row.engine as string) ?? null,
    approximateRowCount:
      row.table_rows === null ? null : Number(row.table_rows),
    comment: (row.table_comment as string) || null,
  }));
}

/** テーブルのカラム一覧を ordinal_position 順に取得する。 */
export async function getTableColumns(
  databaseName: string,
  tableName: string,
): Promise<ColumnInfo[]> {
  const pool = await getPoolForOperation(databaseName, "read-only");
  await assertTableExists(pool, databaseName, tableName);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT column_name AS column_name, data_type AS data_type,
            column_type AS column_type, is_nullable AS is_nullable,
            column_default AS column_default, extra AS extra,
            column_key AS column_key, column_comment AS column_comment,
            ordinal_position AS ordinal_position
     FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ?
     ORDER BY ordinal_position`,
    [databaseName, tableName],
  );

  return rows.map((row) => ({
    name: row.column_name as string,
    dataType: row.data_type as string,
    columnType: row.column_type as string,
    isNullable: row.is_nullable === "YES",
    columnDefault: (row.column_default as string) ?? null,
    extra: (row.extra as string) ?? "",
    columnKey: (row.column_key as string) ?? "",
    comment: (row.column_comment as string) || null,
    ordinalPosition: Number(row.ordinal_position),
  }));
}

/** テーブルのインデックス一覧を取得する（information_schema.STATISTICS を index_name 単位に集約）。 */
export async function getTableIndexes(
  databaseName: string,
  tableName: string,
): Promise<IndexInfo[]> {
  const pool = await getPoolForOperation(databaseName, "read-only");
  await assertTableExists(pool, databaseName, tableName);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT index_name AS index_name, non_unique AS non_unique,
            column_name AS column_name, seq_in_index AS seq_in_index
     FROM information_schema.statistics
     WHERE table_schema = ? AND table_name = ?
     ORDER BY index_name, seq_in_index`,
    [databaseName, tableName],
  );

  const byName = new Map<string, IndexInfo>();
  for (const row of rows) {
    const name = row.index_name as string;
    if (!byName.has(name)) {
      byName.set(name, {
        name,
        unique: Number(row.non_unique) === 0,
        columns: [],
      });
    }
    byName.get(name)!.columns.push(row.column_name as string);
  }
  return Array.from(byName.values());
}

/** テーブルの外部キー制約を取得する（information_schema.KEY_COLUMN_USAGE）。参照先は同一DB内のみ対象。 */
export async function getTableForeignKeys(
  databaseName: string,
  tableName: string,
): Promise<ForeignKeyInfo[]> {
  const pool = await getPoolForOperation(databaseName, "read-only");
  await assertTableExists(pool, databaseName, tableName);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT column_name AS column_name, referenced_table_name AS referenced_table_name,
            referenced_column_name AS referenced_column_name
     FROM information_schema.key_column_usage
     WHERE table_schema = ? AND table_name = ?
       AND referenced_table_schema = ? AND referenced_table_name IS NOT NULL`,
    [databaseName, tableName, databaseName],
  );

  return rows.map((row) => ({
    columnName: row.column_name as string,
    referencedTable: row.referenced_table_name as string,
    referencedColumn: row.referenced_column_name as string,
  }));
}

const MAX_PAGE_SIZE = 200;

export interface GetRowsOptions {
  page?: number;
  pageSize?: number;
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  search?: string;
  filterColumn?: string;
  filterValue?: string;
}

/**
 * レコード一覧を取得する（読み取り専用）。カラム名は必ず information_schema で実在確認してから
 * SQLに組み込み、値は常にプレースホルダーを使う。
 */
export async function getTableRows(
  databaseName: string,
  tableName: string,
  options: GetRowsOptions = {},
): Promise<RowsPage> {
  const pool = await getPoolForOperation(databaseName, "read-only");
  await assertTableExists(pool, databaseName, tableName);

  const columns = await getTableColumns(databaseName, tableName);
  const columnNames = columns.map((c) => c.name);
  const qualifiedTable = qualifyTable(databaseName, tableName);

  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, options.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  let orderClause = "";
  if (options.sortColumn) {
    await assertColumnExists(pool, databaseName, tableName, options.sortColumn);
    const direction = options.sortDirection === "desc" ? "DESC" : "ASC";
    orderClause = ` ORDER BY ${quoteColumn(options.sortColumn)} ${direction}`;
  }

  const whereConditions: string[] = [];
  const whereParams: unknown[] = [];

  if (options.filterColumn) {
    await assertColumnExists(pool, databaseName, tableName, options.filterColumn);
    whereConditions.push(`${quoteColumn(options.filterColumn)} = ?`);
    whereParams.push(options.filterValue ?? "");
  }

  if (options.search) {
    const searchableColumns = columns.filter((c) =>
      /char|text|varchar/i.test(c.dataType),
    );
    if (searchableColumns.length > 0) {
      whereConditions.push(
        "(" +
          searchableColumns.map((c) => `${quoteColumn(c.name)} LIKE ?`).join(" OR ") +
          ")",
      );
      whereParams.push(
        ...searchableColumns.map(() => `%${options.search}%`),
      );
    }
  }

  const whereClause =
    whereConditions.length > 0 ? " WHERE " + whereConditions.join(" AND ") : "";

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM ${qualifiedTable}${whereClause}`,
    whereParams,
  );
  const total = Number(countRows[0]?.total ?? 0);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM ${qualifiedTable}${whereClause}${orderClause} LIMIT ? OFFSET ?`,
    [...whereParams, pageSize, offset],
  );

  return {
    columns: columnNames,
    rows: rows as Record<string, unknown>[],
    total,
    page,
    pageSize,
  };
}

export class MissingPrimaryKeyError extends Error {
  constructor(tableName: string) {
    super(`${tableName} には主キーがないため、個別のレコード編集・削除はできません`);
    this.name = "MissingPrimaryKeyError";
  }
}

/** テーブルの主キー構成カラムを、複合主キーの場合は定義順で返す（PRIMARYインデックスがなければ空配列）。 */
export async function getPrimaryKeyColumns(
  databaseName: string,
  tableName: string,
): Promise<string[]> {
  const indexes = await getTableIndexes(databaseName, tableName);
  return indexes.find((index) => index.name === "PRIMARY")?.columns ?? [];
}

/** 主キー値を指定して1レコードを取得する（編集フォームの初期値表示用）。 */
export async function getRowByPrimaryKey(
  databaseName: string,
  tableName: string,
  pkValues: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  const pool = await getPoolForOperation(databaseName, "data-write");
  await assertTableExists(pool, databaseName, tableName);

  const pkColumns = await getPrimaryKeyColumns(databaseName, tableName);
  if (pkColumns.length === 0) {
    throw new MissingPrimaryKeyError(tableName);
  }
  for (const column of pkColumns) {
    await assertColumnExists(pool, databaseName, tableName, column);
  }

  const qualifiedTable = qualifyTable(databaseName, tableName);
  const whereClause = pkColumns.map((c) => `${quoteColumn(c)} = ?`).join(" AND ");
  const params = pkColumns.map((c) => pkValues[c]);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM ${qualifiedTable} WHERE ${whereClause} LIMIT 1`,
    params,
  );
  return (rows[0] as Record<string, unknown>) ?? null;
}

export interface InsertRowResult {
  insertId: number | null;
  affectedRows: number;
}

/** レコードを追加する。カラム名は実在確認済みのもののみ受け付け、値は常にプレースホルダーを使う。 */
export async function insertRow(
  databaseName: string,
  tableName: string,
  data: Record<string, unknown>,
): Promise<InsertRowResult> {
  const pool = await getPoolForOperation(databaseName, "data-write");
  await assertTableExists(pool, databaseName, tableName);

  const columnNames = Object.keys(data);
  for (const column of columnNames) {
    await assertColumnExists(pool, databaseName, tableName, column);
  }
  if (columnNames.length === 0) {
    throw new Error("挿入するカラムがありません");
  }

  const qualifiedTable = qualifyTable(databaseName, tableName);
  const columnsSql = columnNames.map((c) => quoteColumn(c)).join(", ");
  const placeholders = columnNames.map(() => "?").join(", ");
  const values = columnNames.map((c) => data[c]);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO ${qualifiedTable} (${columnsSql}) VALUES (${placeholders})`,
    values,
  );
  return { insertId: result.insertId || null, affectedRows: result.affectedRows };
}

/** 主キーを条件にレコードを更新する。主キーがないテーブルは MissingPrimaryKeyError を投げる。 */
export async function updateRow(
  databaseName: string,
  tableName: string,
  pkValues: Record<string, string>,
  data: Record<string, unknown>,
): Promise<{ affectedRows: number }> {
  const pool = await getPoolForOperation(databaseName, "data-write");
  await assertTableExists(pool, databaseName, tableName);

  const pkColumns = await getPrimaryKeyColumns(databaseName, tableName);
  if (pkColumns.length === 0) {
    throw new MissingPrimaryKeyError(tableName);
  }

  const columnNames = Object.keys(data);
  for (const column of [...columnNames, ...pkColumns]) {
    await assertColumnExists(pool, databaseName, tableName, column);
  }
  if (columnNames.length === 0) {
    throw new Error("更新するカラムがありません");
  }

  const qualifiedTable = qualifyTable(databaseName, tableName);
  const setSql = columnNames.map((c) => `${quoteColumn(c)} = ?`).join(", ");
  const whereSql = pkColumns.map((c) => `${quoteColumn(c)} = ?`).join(" AND ");
  const params = [...columnNames.map((c) => data[c]), ...pkColumns.map((c) => pkValues[c])];

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE ${qualifiedTable} SET ${setSql} WHERE ${whereSql}`,
    params,
  );
  return { affectedRows: result.affectedRows };
}

/**
 * 主キーのリストを条件にレコードを削除する（単一・複数選択削除の両方に対応）。
 * 常に主キーの完全一致条件のみで構成するため、条件なしDELETEにはなり得ない。
 */
export async function deleteRows(
  databaseName: string,
  tableName: string,
  pkValuesList: Record<string, string>[],
): Promise<{ affectedRows: number }> {
  const pool = await getPoolForOperation(databaseName, "data-write");
  await assertTableExists(pool, databaseName, tableName);

  const pkColumns = await getPrimaryKeyColumns(databaseName, tableName);
  if (pkColumns.length === 0) {
    throw new MissingPrimaryKeyError(tableName);
  }
  if (pkValuesList.length === 0) {
    return { affectedRows: 0 };
  }
  for (const column of pkColumns) {
    await assertColumnExists(pool, databaseName, tableName, column);
  }

  const qualifiedTable = qualifyTable(databaseName, tableName);
  const singleCondition = `(${pkColumns.map((c) => `${quoteColumn(c)} = ?`).join(" AND ")})`;
  const whereSql = pkValuesList.map(() => singleCondition).join(" OR ");
  const params = pkValuesList.flatMap((pkValues) => pkColumns.map((c) => pkValues[c]));

  const [result] = await pool.query<ResultSetHeader>(
    `DELETE FROM ${qualifiedTable} WHERE ${whereSql}`,
    params,
  );
  return { affectedRows: result.affectedRows };
}

// --- テーブル管理（構造変更用ロール = schema-write が必要） ---
// 識別子（DB名・テーブル名）のみで構成するDDLのため、値のバインドが効かない
// テーブル定義（カラム型等）は扱わない。すべて文字種チェック済みの識別子のみを使う。

/** テーブル名を変更する。 */
export async function renameTable(
  databaseName: string,
  oldTableName: string,
  newTableName: string,
): Promise<void> {
  const pool = await getPoolForOperation(databaseName, "schema-write");
  await assertTableExists(pool, databaseName, oldTableName);
  assertSafeTableName(newTableName);

  const qualifiedOld = qualifyTable(databaseName, oldTableName);
  const qualifiedNew = qualifyTable(databaseName, newTableName);
  await pool.query(`RENAME TABLE ${qualifiedOld} TO ${qualifiedNew}`);
}

/** テーブルを削除する（破壊的操作。呼び出し側で再認証・対象名入力確認を行うこと）。 */
export async function dropTable(databaseName: string, tableName: string): Promise<void> {
  const pool = await getPoolForOperation(databaseName, "schema-write");
  await assertTableExists(pool, databaseName, tableName);

  const qualifiedTable = qualifyTable(databaseName, tableName);
  await pool.query(`DROP TABLE ${qualifiedTable}`);
}

/** テーブルを空データ化する（破壊的操作。呼び出し側で再認証・対象名入力確認を行うこと）。 */
export async function truncateTable(databaseName: string, tableName: string): Promise<void> {
  const pool = await getPoolForOperation(databaseName, "schema-write");
  await assertTableExists(pool, databaseName, tableName);

  const qualifiedTable = qualifyTable(databaseName, tableName);
  await pool.query(`TRUNCATE TABLE ${qualifiedTable}`);
}

// --- カラム管理（構造変更用ロール = schema-write が必要） ---
// sqlType は lib/column-types.ts の許可リストテンプレートで組み立てたものだけを渡すこと。

export interface ColumnDefinitionInput {
  columnName: string;
  sqlType: string;
  nullable: boolean;
  defaultValue?: string;
}

/** カラムを追加する。 */
export async function addColumn(
  databaseName: string,
  tableName: string,
  input: ColumnDefinitionInput,
): Promise<void> {
  const pool = await getPoolForOperation(databaseName, "schema-write");
  await assertTableExists(pool, databaseName, tableName);
  assertSafeColumnName(input.columnName);

  const qualifiedTable = qualifyTable(databaseName, tableName);
  const nullSql = input.nullable ? "NULL" : "NOT NULL";
  let sql = `ALTER TABLE ${qualifiedTable} ADD COLUMN ${quoteColumn(input.columnName)} ${input.sqlType} ${nullSql}`;
  if (input.defaultValue) {
    sql += ` DEFAULT ${sqlEscape(input.defaultValue)}`;
  }
  await pool.query(sql);
}

export interface ColumnModificationInput {
  sqlType: string;
  nullable: boolean;
  defaultValue?: string;
  comment?: string;
  position?: "first" | { after: string };
}

/** カラムの型・NULL可否・デフォルト値・コメント・並び順をまとめて変更する（MODIFY COLUMN）。 */
export async function modifyColumn(
  databaseName: string,
  tableName: string,
  columnName: string,
  input: ColumnModificationInput,
): Promise<void> {
  const pool = await getPoolForOperation(databaseName, "schema-write");
  await assertTableExists(pool, databaseName, tableName);
  await assertColumnExists(pool, databaseName, tableName, columnName);

  const qualifiedTable = qualifyTable(databaseName, tableName);
  const nullSql = input.nullable ? "NULL" : "NOT NULL";
  let sql = `ALTER TABLE ${qualifiedTable} MODIFY COLUMN ${quoteColumn(columnName)} ${input.sqlType} ${nullSql}`;
  if (input.defaultValue) {
    sql += ` DEFAULT ${sqlEscape(input.defaultValue)}`;
  }
  if (input.comment) {
    sql += ` COMMENT ${sqlEscape(input.comment)}`;
  }
  if (input.position === "first") {
    sql += " FIRST";
  } else if (input.position) {
    await assertColumnExists(pool, databaseName, tableName, input.position.after);
    sql += ` AFTER ${quoteColumn(input.position.after)}`;
  }
  await pool.query(sql);
}

/** カラムを削除する（破壊的操作。呼び出し側で再認証・対象名入力確認を行うこと）。 */
export async function dropColumn(
  databaseName: string,
  tableName: string,
  columnName: string,
): Promise<void> {
  const pool = await getPoolForOperation(databaseName, "schema-write");
  await assertTableExists(pool, databaseName, tableName);
  await assertColumnExists(pool, databaseName, tableName, columnName);

  const qualifiedTable = qualifyTable(databaseName, tableName);
  await pool.query(`ALTER TABLE ${qualifiedTable} DROP COLUMN ${quoteColumn(columnName)}`);
}

// --- インデックス管理（構造変更用ロール = schema-write が必要） ---

/** インデックスを追加する（PRIMARY KEY / UNIQUE / 通常インデックスの複合対応）。 */
export async function addIndex(
  databaseName: string,
  tableName: string,
  input: { indexName: string; columns: string[]; unique: boolean },
): Promise<void> {
  const pool = await getPoolForOperation(databaseName, "schema-write");
  await assertTableExists(pool, databaseName, tableName);
  if (input.columns.length === 0) {
    throw new Error("インデックス対象のカラムを1つ以上指定してください");
  }
  assertSafeIndexName(input.indexName);
  for (const column of input.columns) {
    await assertColumnExists(pool, databaseName, tableName, column);
  }

  const qualifiedTable = qualifyTable(databaseName, tableName);
  const columnsSql = input.columns.map((c) => quoteColumn(c)).join(", ");
  const indexType = input.unique ? "UNIQUE INDEX" : "INDEX";
  await pool.query(
    `ALTER TABLE ${qualifiedTable} ADD ${indexType} ${quoteIdentifier(input.indexName)} (${columnsSql})`,
  );
}

/** PRIMARY KEY を追加する。 */
export async function addPrimaryKey(
  databaseName: string,
  tableName: string,
  columns: string[],
): Promise<void> {
  const pool = await getPoolForOperation(databaseName, "schema-write");
  await assertTableExists(pool, databaseName, tableName);
  if (columns.length === 0) {
    throw new Error("主キーにするカラムを1つ以上指定してください");
  }
  for (const column of columns) {
    await assertColumnExists(pool, databaseName, tableName, column);
  }

  const qualifiedTable = qualifyTable(databaseName, tableName);
  const columnsSql = columns.map((c) => quoteColumn(c)).join(", ");
  await pool.query(`ALTER TABLE ${qualifiedTable} ADD PRIMARY KEY (${columnsSql})`);
}

/** インデックスを削除する（PRIMARYを含む破壊的操作。呼び出し側で再認証確認を行うこと）。 */
export async function dropIndex(
  databaseName: string,
  tableName: string,
  indexName: string,
): Promise<void> {
  const pool = await getPoolForOperation(databaseName, "schema-write");
  await assertTableExists(pool, databaseName, tableName);

  const qualifiedTable = qualifyTable(databaseName, tableName);
  if (indexName === "PRIMARY") {
    await pool.query(`ALTER TABLE ${qualifiedTable} DROP PRIMARY KEY`);
    return;
  }
  assertSafeIndexName(indexName);
  await pool.query(`ALTER TABLE ${qualifiedTable} DROP INDEX ${quoteIdentifier(indexName)}`);
}

export interface CreateTableColumnInput {
  columnName: string;
  sqlType: string;
  nullable: boolean;
  primaryKey: boolean;
}

/** テーブルを新規作成する。sqlType は column-types.ts の許可リストで組み立てたものだけを渡すこと。 */
export async function createTable(
  databaseName: string,
  tableName: string,
  columns: CreateTableColumnInput[],
): Promise<void> {
  const pool = await getPoolForOperation(databaseName, "schema-write");
  assertSafeTableName(tableName);
  if (columns.length === 0) {
    throw new Error("カラムを1つ以上指定してください");
  }
  for (const column of columns) {
    assertSafeColumnName(column.columnName);
  }

  const qualifiedTable = qualifyTable(databaseName, tableName);
  const columnDefs = columns.map(
    (c) => `${quoteColumn(c.columnName)} ${c.sqlType} ${c.nullable ? "NULL" : "NOT NULL"}`,
  );
  const primaryKeyColumns = columns.filter((c) => c.primaryKey).map((c) => c.columnName);
  if (primaryKeyColumns.length > 0) {
    columnDefs.push(`PRIMARY KEY (${primaryKeyColumns.map((c) => quoteColumn(c)).join(", ")})`);
  }

  await pool.query(
    `CREATE TABLE ${qualifiedTable} (${columnDefs.join(", ")}) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
}
