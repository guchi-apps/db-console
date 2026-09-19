import type { EventEmitter } from "node:events";

import type { FieldPacket, ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import type { SqlQueryType } from "@prisma/client";

import { FORBIDDEN_DATABASE_NAMES } from "@/lib/config";
import { assertSafeDatabaseName, quoteIdentifier } from "@/lib/identifier";
import { getPoolForOperation, type DatabaseOperation } from "@/lib/target-db";
import { assertNoCrossDatabaseAccess, validateSqlForExecution } from "@/lib/sql-guard";

/** SQLの種別ごとに、どのロールのプールで実行するか（#105 以降、認可判定には使わない）。 */
const OPERATION_BY_QUERY_TYPE: Record<SqlQueryType, DatabaseOperation> = {
  SELECT: "read-only",
  INSERT: "data-write",
  UPDATE: "data-write",
  DELETE: "data-write",
  CREATE_TABLE: "schema-write",
  ALTER_TABLE: "schema-write",
  // SHOW / DESCRIBE / EXPLAIN は読み取り専用なので、通常操作用ロールで実行する（#85）。
  SHOW: "read-only",
  DESCRIBE: "read-only",
  EXPLAIN: "read-only",
  OTHER: "schema-write", // validateSqlForExecution が先に弾くため到達しない想定
};

/**
 * 結果として返す行数の上限。本番は `--max-old-space-size=128` で動いており、他アプリの大きい
 * テーブルへの `SELECT *` を全件メモリに載せると落ちる（#136）。結果はサーバーアクションの
 * 戻り値としてシリアライズされ、画面が全行を描画するため、読み込み側だけでなく表示側の
 * 負荷を抑える意味でもこの件数で打ち切る。
 */
export const MAX_RESULT_ROWS = 1000;

export interface SqlExecutionResult {
  queryType: SqlQueryType;
  durationMs: number;
  columns: string[];
  rows: Record<string, unknown>[];
  affectedRows: number | null;
  /** 行数の上限で読み取りを打ち切った場合 true。`rows` は先頭 `MAX_RESULT_ROWS` 件だけになる。 */
  truncated: boolean;
}

/**
 * mysql2 のコールバック版クエリ（`connection.query(sql)` にコールバックを渡さずに得る、
 * イベントを発行する Query オブジェクト）のうち、ここで使う部分だけ。
 */
export interface QueryEmitter extends EventEmitter {
  on(event: "fields", listener: (fields: FieldPacket[] | undefined) => void): this;
  on(event: "result", listener: (row: unknown) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "end", listener: () => void): this;
}

export type CollectedQuery =
  | { kind: "rows"; fields: FieldPacket[]; rows: Record<string, unknown>[]; truncated: boolean }
  | { kind: "ok"; header: ResultSetHeader };

/**
 * クエリの結果を最大 `maxRows` 行だけ集める。上限を超える行が届いた時点で、それ以降は
 * メモリへ載せず、`onTruncate` を呼んで打ち切る。
 *
 * `connection.query(sql)` にコールバックを渡す形だと mysql2 が全行を配列へ積んでしまうため、
 * 行ごとに届く `result` イベントで受けて自分で数える。
 * 打ち切り後もサーバーは残りの行を送り続けるので、`onTruncate` では接続を破棄する
 * （読み残しのあるコネクションをプールへ戻してはいけない）。
 */
export function collectQueryResult(
  query: QueryEmitter,
  maxRows: number,
  onTruncate: () => void,
): Promise<CollectedQuery> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let fields: FieldPacket[] | undefined;
    const rows: Record<string, unknown>[] = [];

    query.on("fields", (received) => {
      fields = received;
    });
    query.on("result", (payload) => {
      if (settled) return;
      // 行を返さない文（INSERT 等）は fields が undefined のまま、結果として OK パケットが届く。
      if (!fields) {
        settled = true;
        resolve({ kind: "ok", header: payload as ResultSetHeader });
        return;
      }
      if (rows.length >= maxRows) {
        settled = true;
        onTruncate();
        resolve({ kind: "rows", fields, rows, truncated: true });
        return;
      }
      rows.push(payload as Record<string, unknown>);
    });
    query.on("error", (error) => {
      // 打ち切りで接続を壊したあとに届くエラーは、結果が確定済みなので捨てる。
      if (settled) return;
      settled = true;
      reject(error);
    });
    query.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(
        fields
          ? { kind: "rows", fields, rows, truncated: false }
          : { kind: "ok", header: { affectedRows: 0 } as ResultSetHeader },
      );
    });
  });
}

/**
 * このコネクションのロールから見えるDB名のうち、システムDB（information_schema 等）を除いたもの。
 * data/schema ロールの information_schema.schemata は GRANT 済みのDBしか返さないので、
 * 「このSQL画面から権限上は触れてしまうDB」と一致する。
 */
async function listReachableDatabaseNames(connection: PoolConnection): Promise<string[]> {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT schema_name AS schema_name FROM information_schema.schemata",
  );
  return rows
    .map((row) => String(row.schema_name))
    .filter((name) => !FORBIDDEN_DATABASE_NAMES.has(name.toLowerCase()));
}

/**
 * 任意のSQL文を1文だけ実行する。lib/sql-guard.ts の全チェックを通過したSQLのみ実行する。
 * プールされたコネクションは database を固定していないため、実行直前に USE で
 * 対象DBへ切り替える（このコネクションは release 後に別DB向けに再利用されうるが、
 * 次の利用者も必ず自分の USE を発行するため問題ない）。
 *
 * 許可リストの判定は開いているDB名にしか掛からず、ロールは GRANT 済みのDBすべてに権限を持つため、
 * SQL側で `app_b.t` のように別のDBを名前で指すと許可リスト外のDBにも届いてしまう。
 * そのため、開いているDB以外を名前で指すSQLは実行前に拒否する（#134）。
 */
export async function executeSql(
  databaseName: string,
  sql: string,
): Promise<SqlExecutionResult> {
  assertSafeDatabaseName(databaseName);
  const queryType = validateSqlForExecution(sql);
  const pool = await getPoolForOperation(databaseName, OPERATION_BY_QUERY_TYPE[queryType]);

  const connection = await pool.getConnection();
  let discard = false;
  try {
    assertNoCrossDatabaseAccess(
      sql,
      queryType,
      databaseName,
      await listReachableDatabaseNames(connection),
    );
    await connection.query(`USE ${quoteIdentifier(databaseName)}`);

    const start = Date.now();
    // Promise 版のラッパーは全行を配列へ積んでしまうため、内側のコールバック版で行ごとに受ける。
    const collected = await collectQueryResult(
      connection.connection.query(sql) as unknown as QueryEmitter,
      MAX_RESULT_ROWS,
      () => {
        discard = true;
      },
    );
    const durationMs = Date.now() - start;

    if (collected.kind === "rows") {
      return {
        queryType,
        durationMs,
        columns: collected.fields.map((f) => f.name),
        rows: collected.rows,
        affectedRows: null,
        truncated: collected.truncated,
      };
    }

    return {
      queryType,
      durationMs,
      columns: [],
      rows: [],
      affectedRows: collected.header.affectedRows ?? null,
      truncated: false,
    };
  } finally {
    if (discard) {
      connection.destroy();
    } else {
      connection.release();
    }
  }
}
