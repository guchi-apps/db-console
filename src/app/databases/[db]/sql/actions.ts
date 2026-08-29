"use server";

import { writeAuditLog } from "@/lib/audit";
import { requireUserId } from "@/lib/session";
import { executeSql, type SqlExecutionResult } from "@/lib/sql-execute";
import { db as prismaDb } from "@/lib/db";

export interface SqlActionState {
  sql: string;
  error?: string;
  result?: SqlExecutionResult;
}

export async function executeSqlAction(
  prevState: SqlActionState,
  formData: FormData,
): Promise<SqlActionState> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return { sql: prevState.sql, error: "認証が必要です" };
  }

  const databaseName = String(formData.get("__db") ?? "");
  const sql = String(formData.get("sql") ?? "");

  const start = Date.now();
  try {
    const result = await executeSql(databaseName, sql);
    await prismaDb.sqlHistory.create({
      data: {
        userId,
        databaseName,
        sqlText: sql,
        queryType: result.queryType,
        durationMs: result.durationMs,
        affectedRows: result.affectedRows,
        status: "SUCCESS",
      },
    });
    await writeAuditLog({
      userId,
      action: "SQL_EXECUTE",
      databaseName,
      sqlText: sql,
      affectedRows: result.affectedRows ?? undefined,
      status: "SUCCESS",
    });
    return { sql, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "SQL実行に失敗しました";
    await prismaDb.sqlHistory.create({
      data: {
        userId,
        databaseName,
        sqlText: sql,
        queryType: "OTHER",
        durationMs: Date.now() - start,
        status: "FAILURE",
        errorMessage: message,
      },
    });
    await writeAuditLog({
      userId,
      action: "SQL_EXECUTE",
      databaseName,
      sqlText: sql,
      status: "FAILURE",
      errorMessage: message,
    });
    return { sql, error: message };
  }
}
