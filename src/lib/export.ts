import { escape as sqlEscape } from "mysql2";
import type { PoolConnection as CorePoolConnection, RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";

import { assertBaseTableExists, qualifyTable, quoteColumn } from "@/lib/identifier";
import { getPoolForOperation } from "@/lib/target-db";
import { getPrimaryKeyColumns, getTableColumns, type ColumnInfo } from "@/lib/introspection";

const BATCH_SIZE = 500;

/** 呼び出し側が組み立てた絞り込み条件（WHERE の中身）。 */
interface RowFilter {
  sql: string;
  params: unknown[];
}

/**
 * キーセット方式で読み進めてよい主キーの型。
 * 「`ORDER BY` の並び」と「`>` による比較」が一致し、受け取った値をそのまま次の条件へ渡せる型に限る。
 * ENUM / SET は並びが定義順・比較が文字列で食い違い、FLOAT / DOUBLE は返ってきた値が格納値と
 * 一致しないため、同じ行を読み直し続けるおそれがある。それ以外は1本のクエリで読み出す。
 */
const KEYSET_SAFE_TYPES =
  /^(tinyint|smallint|mediumint|int|integer|bigint|decimal|char|varchar|binary|varbinary|date|datetime|timestamp)$/i;
const INTEGER_TYPES = /^(tinyint|smallint|mediumint|int|integer|bigint)$/i;

/**
 * 主キー `(k1, k2, ..., kn)` が直前の値より後ろにある、という条件を返す。
 * 行値コンストラクタ `(k1, k2) > (?, ?)` はMariaDBでインデックスの範囲検索にならないため、
 * `k1 > ? OR (k1 = ? AND k2 > ?) OR ...` へ展開する。値は {@link buildKeysetParams} の順に渡す。
 */
export function buildKeysetCondition(keyColumns: string[]): string {
  return keyColumns
    .map((column, i) => {
      const equals = keyColumns.slice(0, i).map((c) => `${quoteColumn(c)} = ?`);
      return `(${[...equals, `${quoteColumn(column)} > ?`].join(" AND ")})`;
    })
    .join(" OR ");
}

/** {@link buildKeysetCondition} のプレースホルダーへ渡す値を、直前の行の主キー値から作る。 */
export function buildKeysetParams(lastKey: unknown[]): unknown[] {
  return lastKey.flatMap((_, i) => lastKey.slice(0, i + 1));
}

/**
 * 整数の主キー値を BigInt にして渡す。文字列のまま渡すと、MariaDBは整数カラムとの比較を
 * 浮動小数点で行い、2^53 を超える BIGINT で位置がずれる（BigInt なら引用符なしの数値リテラルになる）。
 */
function toKeyParam(value: unknown, column: ColumnInfo): unknown {
  if (INTEGER_TYPES.test(column.dataType) && (typeof value === "number" || typeof value === "string")) {
    return BigInt(value);
  }
  return value;
}

/**
 * エクスポート対象の行を、大量データでもメモリに載せ切らずに順に返す（#138）。
 *
 * 主キーがあれば主キー順に並べ、`WHERE 主キー > 前回の最後の値` で続きを読む（キーセット方式）。
 * `LIMIT ? OFFSET ?` だと並び順が保証されないうえ、読んでいる間に他アプリが行を追加・削除すると
 * 位置がずれ、行が抜けたり重複したりする（SQLエクスポートでは流し込むときに主キー違反になる）。
 *
 * 主キーが無い・キーセットに向かない型の主キー・ビューは、1本のSELECTを1つのコネクションで
 * ストリーミングして読む（1文の中では同じスナップショットを読むため、抜けも重複も起きない）。
 *
 * BIGINT は `supportBigNumbers` で、Number で表せない値だけ文字列で受け取る（丸めた値で続きを
 * 読むと位置がずれ、出力する値も変わってしまうため）。
 */
async function* streamTableRows(
  pool: Pool,
  databaseName: string,
  tableName: string,
  columns: ColumnInfo[],
  filter?: RowFilter,
): AsyncGenerator<RowDataPacket> {
  const qualifiedTable = qualifyTable(databaseName, tableName);
  const pkColumns = (await getPrimaryKeyColumns(databaseName, tableName)).map((name) =>
    columns.find((c) => c.name === name),
  );
  const keyColumns = pkColumns.every((c) => c && KEYSET_SAFE_TYPES.test(c.dataType))
    ? (pkColumns as ColumnInfo[])
    : [];

  if (keyColumns.length === 0) {
    const whereClause = filter ? ` WHERE ${filter.sql}` : "";
    yield* streamSingleQuery(pool, `SELECT * FROM ${qualifiedTable}${whereClause}`, filter?.params ?? []);
    return;
  }

  const keyNames = keyColumns.map((c) => c.name);
  const orderClause = ` ORDER BY ${keyNames.map((c) => `${quoteColumn(c)} ASC`).join(", ")}`;
  let lastKey: unknown[] | null = null;
  for (;;) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter) {
      conditions.push(`(${filter.sql})`);
      params.push(...filter.params);
    }
    if (lastKey) {
      conditions.push(`(${buildKeysetCondition(keyNames)})`);
      params.push(...buildKeysetParams(lastKey));
    }
    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await pool.query<RowDataPacket[]>(
      {
        sql: `SELECT * FROM ${qualifiedTable}${whereClause}${orderClause} LIMIT ?`,
        supportBigNumbers: true,
      },
      [...params, BATCH_SIZE],
    );
    yield* rows;
    if (rows.length < BATCH_SIZE) break;
    const lastRow = rows[rows.length - 1];
    lastKey = keyColumns.map((c) => toKeyParam(lastRow[c.name], c));
  }
}

/**
 * 1本のSELECTをプールから借りた1つのコネクションでストリーミングする。
 * 読み切れば返却し、途中で打ち切られた（ダウンロードの中断・エラー）ときは、結果の残りが
 * 流れてくるコネクションをプールへ戻さず破棄する。
 */
async function* streamSingleQuery(
  pool: Pool,
  sql: string,
  params: unknown[],
): AsyncGenerator<RowDataPacket> {
  const connection = await pool.getConnection();
  let completed = false;
  try {
    // `.connection` の実体はコールバック版のコネクション（型定義は Promise 版になっている）。
    // `.stream()` はコールバック版の Query にしか無い。
    const core = connection.connection as unknown as CorePoolConnection;
    const stream = core.query({ sql, supportBigNumbers: true }, params).stream();
    for await (const row of stream) {
      yield row as RowDataPacket;
    }
    completed = true;
  } finally {
    if (completed) connection.release();
    else connection.destroy();
  }
}

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

  yield columnNames.map(csvEscape).join(",") + "\r\n";

  let filter: RowFilter | undefined;
  if (options.search) {
    const searchableColumns = columns.filter((c) => /char|text|varchar/i.test(c.dataType));
    if (searchableColumns.length > 0) {
      filter = {
        sql: searchableColumns.map((c) => `${quoteColumn(c.name)} LIKE ?`).join(" OR "),
        params: searchableColumns.map(() => `%${options.search}%`),
      };
    }
  }

  for await (const row of streamTableRows(pool, databaseName, tableName, columns, filter)) {
    yield columnNames.map((c) => csvEscape(row[c])).join(",") + "\r\n";
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

  for await (const row of streamTableRows(pool, databaseName, tableName, columns)) {
    const values = columnNames.map((c) => sqlEscape(row[c])).join(", ");
    yield `INSERT INTO ${qualifiedTable} (${columnsSql}) VALUES (${values});\n`;
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
