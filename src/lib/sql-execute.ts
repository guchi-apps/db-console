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

export interface SqlExecutionResult {
  queryType: SqlQueryType;
  durationMs: number;
  columns: string[];
  rows: Record<string, unknown>[];
  affectedRows: number | null;
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
  try {
    assertNoCrossDatabaseAccess(
      sql,
      queryType,
      databaseName,
      await listReachableDatabaseNames(connection),
    );
    await connection.query(`USE ${quoteIdentifier(databaseName)}`);

    const start = Date.now();
    const [result, fields] = (await connection.query(sql)) as [
      RowDataPacket[] | ResultSetHeader,
      FieldPacket[],
    ];
    const durationMs = Date.now() - start;

    if (Array.isArray(result)) {
      const columns = fields?.length
        ? fields.map((f) => f.name)
        : Object.keys(result[0] ?? {});
      return {
        queryType,
        durationMs,
        columns,
        rows: result as unknown as Record<string, unknown>[],
        affectedRows: null,
      };
    }

    return {
      queryType,
      durationMs,
      columns: [],
      rows: [],
      affectedRows: result.affectedRows ?? null,
    };
  } finally {
    connection.release();
  }
}
