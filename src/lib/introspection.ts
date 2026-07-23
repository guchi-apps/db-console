import type { RowDataPacket } from "mysql2";

import {
  assertColumnExists,
  assertSafeDatabaseName,
  assertTableExists,
  qualifyTable,
  quoteColumn,
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

const MAX_PAGE_SIZE = 200;

export interface GetRowsOptions {
  page?: number;
  pageSize?: number;
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  search?: string;
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

  let whereClause = "";
  const whereParams: unknown[] = [];
  if (options.search) {
    const searchableColumns = columns.filter((c) =>
      /char|text|varchar/i.test(c.dataType),
    );
    if (searchableColumns.length > 0) {
      whereClause =
        " WHERE " +
        searchableColumns
          .map((c) => `${quoteColumn(c.name)} LIKE ?`)
          .join(" OR ");
      whereParams.push(
        ...searchableColumns.map(() => `%${options.search}%`),
      );
    }
  }

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
