"use server";

import type { Prisma } from "@prisma/client";

import { writeAuditLogSafely } from "@/lib/audit";
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

/**
 * 実行履歴を残す。SQLの実行が確定したあとに呼ぶため、書き込みに失敗しても例外を投げない。
 * ここで落ちると実行済みのSQLが「失敗」に見えて再実行され、二重に適用されうる（#135）。
 */
async function saveSqlHistory(data: Prisma.SqlHistoryUncheckedCreateInput): Promise<void> {
  try {
    await prismaDb.sqlHistory.create({ data });
  } catch (error) {
    console.error(
      `SQL実行履歴の書き込みに失敗しました (${data.databaseName} / ${data.status})`,
      error,
    );
  }
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

  // try で囲むのはSQLの実行だけ。履歴・監査ログはSQLの成否が確定したあとに独立して書き、
  // 記録の失敗で実行結果の成否を変えない（#135）。
  const start = Date.now();
  let result: SqlExecutionResult;
  try {
    result = await executeSql(databaseName, sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : "SQL実行に失敗しました";
    await saveSqlHistory({
      userId,
      databaseName,
      sqlText: sql,
      queryType: "OTHER",
      durationMs: Date.now() - start,
      status: "FAILURE",
      errorMessage: message,
    });
    await writeAuditLogSafely({
      userId,
      action: "SQL_EXECUTE",
      databaseName,
      sqlText: sql,
      status: "FAILURE",
      errorMessage: message,
    });
    return { sql, error: message };
  }

  await saveSqlHistory({
    userId,
    databaseName,
    sqlText: sql,
    queryType: result.queryType,
    durationMs: result.durationMs,
    affectedRows: result.affectedRows,
    status: "SUCCESS",
  });
  await writeAuditLogSafely({
    userId,
    action: "SQL_EXECUTE",
    databaseName,
    sqlText: sql,
    affectedRows: result.affectedRows ?? undefined,
    status: "SUCCESS",
  });
  return { sql, result };
}
