"use client";

import { useActionState, useState } from "react";

import { isSchemaChangeSql } from "@/lib/sql-guard";
import { SchemaChangeConfirmButton } from "@/components/schema-change-confirm-button";
import { executeSqlAction, type SqlActionState } from "./actions";

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") {
    if ("toISOString" in value && typeof (value as Date).toISOString === "function") {
      return (value as Date).toISOString();
    }
    return JSON.stringify(value);
  }
  return String(value);
}

export function SqlForm({ db, reauthVerified }: { db: string; reauthVerified: boolean }) {
  const initialState: SqlActionState = { sql: "" };
  const [state, formAction, isPending] = useActionState(executeSqlAction, initialState);
  // 入力中のSQLが構造変更かどうかで送信ボタンを切り替えるため、textarea の内容を追う。
  const [draft, setDraft] = useState("");
  const isSchemaChange = isSchemaChangeSql(draft);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="__db" value={db} />
        <textarea
          name="sql"
          defaultValue={state.sql}
          onChange={(event) => setDraft(event.target.value)}
          required
          rows={6}
          placeholder="SELECT * FROM ... / SHOW CREATE TABLE ... / EXPLAIN SELECT ... のようなSQLを1文だけ入力してください"
          className="w-full rounded-md border px-3 py-2 font-mono text-sm"
        />
        <div className="flex items-center justify-end gap-3">
          {isSchemaChange && (
            <p className="text-muted-foreground text-xs">
              テーブル構造を変更するSQLです。実行前に確認と本人確認が必要です。
            </p>
          )}
          {isSchemaChange ? (
            <SchemaChangeConfirmButton
              title="SQL実行の確認"
              description={`${db} に対してテーブル構造を変更するSQLを実行します。`}
              reauthVerified={reauthVerified}
              fields={[
                { label: "操作", value: "SQLで構造を変更" },
                { label: "データベース", value: db },
                { label: "SQL", field: "sql" },
              ]}
              className="min-h-11 rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
            >
              実行
            </SchemaChangeConfirmButton>
          ) : (
            <button
              type="submit"
              disabled={isPending}
              className="min-h-11 rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
            >
              {isPending ? "実行中..." : "実行"}
            </button>
          )}
        </div>
      </form>

      {state.error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      {state.result && (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">
            種別: {state.result.queryType} / 実行時間: {state.result.durationMs}ms
            {state.result.affectedRows !== null && (
              <> / 影響行数: {state.result.affectedRows}件</>
            )}
          </p>
          {state.result.columns.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {state.result.columns.map((column) => (
                      <th key={column} className="px-3 py-2 text-left font-medium">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.result.rows.map((row, i) => (
                    <tr key={i} className="border-b last:border-0">
                      {state.result!.columns.map((column) => (
                        <td key={column} className="px-3 py-2 whitespace-nowrap">
                          {formatCellValue(row[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {state.result.rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={state.result.columns.length}
                        className="text-muted-foreground px-3 py-6 text-center"
                      >
                        結果がありません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
