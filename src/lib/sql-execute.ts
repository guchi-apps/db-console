import type { FieldPacket, ResultSetHeader, RowDataPacket } from "mysql2";
import type { SqlQueryType } from "@prisma/client";

import { assertSafeDatabaseName, quoteIdentifier } from "@/lib/identifier";
import { getPoolForOperation, type DatabaseOperation } from "@/lib/target-db";
import { validateSqlForExecution } from "@/lib/sql-guard";

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
 * 任意のSQL文を1文だけ実行する。lib/sql-guard.ts の全チェックを通過したSQLのみ実行する。
 * プールされたコネクションは database を固定していないため、実行直前に USE で
 * 対象DBへ切り替える（このコネクションは release 後に別DB向けに再利用されうるが、
 * 次の利用者も必ず自分の USE を発行するため問題ない）。
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
