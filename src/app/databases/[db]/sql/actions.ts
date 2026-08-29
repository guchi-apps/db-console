"use server";

import { writeAuditLog } from "@/lib/audit";
import { requireUserId } from "@/lib/session";
import { isReauthValid } from "@/lib/reauth";
import { isSchemaChangeSql } from "@/lib/sql-guard";
import { executeSql, type SqlExecutionResult } from "@/lib/sql-execute";
import { db as prismaDb } from "@/lib/db";

export interface SqlActionState {
  sql: string;
  error?: string;
  /** 本人確認が足りずに実行しなかった場合。画面が本人確認への導線を出す（#105）。 */
  needsReauth?: boolean;
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

  // CREATE TABLE / ALTER TABLE は構造変更なので、画面からのDDLと同じく本人確認を求める（#105）。
  // ここでリダイレクトすると入力中のSQLが失われるため、状態を返して画面に導線を出させる。
  if (isSchemaChangeSql(sql) && !(await isReauthValid())) {
    return {
      sql,
      needsReauth: true,
      error:
        "テーブル構造を変更するSQLの実行には本人確認が必要です。上の「本人確認する」から確認してください。",
    };
  }

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
