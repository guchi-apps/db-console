import { escape as sqlEscape } from "mysql2";
import type { RowDataPacket } from "mysql2";

import { assertBaseTableExists, qualifyTable, quoteColumn } from "@/lib/identifier";
import { getPoolForOperation } from "@/lib/target-db";
import { getTableColumns } from "@/lib/introspection";

const BATCH_SIZE = 500;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";

  let str: string;
  if (value instanceof Date) str = value.toISOString();
  else if (Buffer.isBuffer(value)) str = `0x${value.toString("hex")}`;
  else if (typeof value === "object") str = JSON.stringify(value);
  else str = String(value);

  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** 表示中/検索結果/テーブル全体のCSVを、大量データでもメモリに載せ切らないようバッチ取得しながら生成する。 */
export async function* streamTableCsvRows(
  databaseName: string,
  tableName: string,
  options: { search?: string } = {},
): AsyncGenerator<string> {
  const pool = await getPoolForOperation(databaseName, "read-only");
  const columns = await getTableColumns(databaseName, tableName);
  const columnNames = columns.map((c) => c.name);
  const qualifiedTable = qualifyTable(databaseName, tableName);

  yield columnNames.map(csvEscape).join(",") + "\r\n";

  let whereClause = "";
  const whereParams: unknown[] = [];
  if (options.search) {
    const searchableColumns = columns.filter((c) => /char|text|varchar/i.test(c.dataType));
    if (searchableColumns.length > 0) {
      whereClause =
        " WHERE " +
        searchableColumns.map((c) => `${quoteColumn(c.name)} LIKE ?`).join(" OR ");
      whereParams.push(...searchableColumns.map(() => `%${options.search}%`));
    }
  }

  let offset = 0;
  for (;;) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM ${qualifiedTable}${whereClause} LIMIT ? OFFSET ?`,
      [...whereParams, BATCH_SIZE, offset],
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      yield columnNames.map((c) => csvEscape(row[c])).join(",") + "\r\n";
    }
    if (rows.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }
}

/**
 * SHOW CREATE TABLE の結果をそのまま構造出力として使う（DDLの再構築より正確・安全）。
 *
 * ビューは対象外にする。ビューへの `SHOW CREATE TABLE` は SHOW VIEW 権限を要求して落ちるうえ、
 * 出力できたとしても `CREATE VIEW` を「テーブル構造」として渡すことになるため。
 */
export async function getTableStructureSql(
  databaseName: string,
  tableName: string,
): Promise<string> {
  const pool = await getPoolForOperation(databaseName, "read-only");
  await assertBaseTableExists(pool, databaseName, tableName);
  const qualifiedTable = qualifyTable(databaseName, tableName);

  const [rows] = await pool.query<RowDataPacket[]>(`SHOW CREATE TABLE ${qualifiedTable}`);
  const row = rows[0] as unknown as Record<string, string>;
  const createStatement = row["Create Table"] ?? Object.values(row)[1];
  return `${createStatement};\n`;
}

/** テーブル構造（CREATE TABLE）+ 全データ（INSERT文）をバッチで生成する。 */
export async function* streamTableStructureAndDataSql(
  databaseName: string,
  tableName: string,
): AsyncGenerator<string> {
  yield await getTableStructureSql(databaseName, tableName);
  yield "\n";

  const pool = await getPoolForOperation(databaseName, "read-only");
  const columns = await getTableColumns(databaseName, tableName);
  const columnNames = columns.map((c) => c.name);
  const qualifiedTable = qualifyTable(databaseName, tableName);
  const columnsSql = columnNames.map((c) => quoteColumn(c)).join(", ");

  let offset = 0;
  for (;;) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM ${qualifiedTable} LIMIT ? OFFSET ?`,
      [BATCH_SIZE, offset],
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      const values = columnNames.map((c) => sqlEscape(row[c])).join(", ");
      yield `INSERT INTO ${qualifiedTable} (${columnsSql}) VALUES (${values});\n`;
    }
    if (rows.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }
}

/**
 * AsyncGenerator を Response 用の ReadableStream に変換する。
 * `firstChunk` を渡した場合、そのチャンクを最初に流してから続きを generator から取得する
 * （呼び出し側で最初の .next() を事前に取得し、許可リスト検証等のエラーを
 * ストリーム開始前に同期的にハンドリングできるようにするため）。
 */
export function asyncGeneratorToStream(
  gen: AsyncGenerator<string>,
  firstChunk?: IteratorResult<string>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let pending = firstChunk;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = pending ?? (await gen.next());
      pending = undefined;
      if (next.done) {
        controller.close();
      } else {
        controller.enqueue(encoder.encode(next.value));
      }
    },
    async cancel() {
      await gen.return?.(undefined);
    },
  });
}
