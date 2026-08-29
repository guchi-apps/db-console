import Link from "next/link";
import { notFound } from "next/navigation";

import { getDatabaseEntry } from "@/lib/config";
import {
  getTableColumns,
  getTableIndexes,
  getTableKind,
  getViewDefinition,
} from "@/lib/introspection";
import { IdentifierNotFoundError } from "@/lib/identifier";
import { requireSessionForPage } from "@/lib/session";
import { isReauthValid } from "@/lib/reauth";
import { COLUMN_TYPE_OPTIONS } from "@/lib/column-types";
import { ColumnEditFields, ColumnTypeSelectFields } from "@/components/column-type-fields";
import { SchemaChangeConfirmButton } from "@/components/schema-change-confirm-button";
import { SchemaChangeNotice } from "@/components/schema-change-notice";
import { renameTableAction } from "../schema-actions";
import {
  addColumnAction,
  addIndexAction,
  dropColumnAction,
  dropIndexAction,
  modifyColumnAction,
} from "../column-actions";

export default async function TableStructurePage({
  params,
  searchParams,
}: {
  params: Promise<{ db: string; table: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireSessionForPage();
  const { db, table } = await params;
  const { error } = await searchParams;

  const entry = await getDatabaseEntry(db);
  if (!entry) {
    notFound();
  }

  let columns, indexes, kind;
  try {
    kind = await getTableKind(db, table);
    [columns, indexes] = await Promise.all([
      getTableColumns(db, table),
      getTableIndexes(db, table),
    ]);
  } catch (error_) {
    if (error_ instanceof IdentifierNotFoundError) {
      notFound();
    }
    throw error_;
  }

  // ビューはカラム型・定義の閲覧のみ。ALTER・RENAME・DROPはいずれも成立しないため導線を出さない。
  // 管理対象DBごとの操作モードは #105 で廃止したため、ビューかどうかだけで導線を決める。
  const isView = kind === "view";
  const canManageSchema = !isView;
  const structurePath = `/databases/${db}/tables/${table}/structure`;
  const reauthVerified = canManageSchema ? await isReauthValid() : false;
  const viewDefinition = isView ? await getViewDefinition(db, table) : null;

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-4xl flex-1 flex-col gap-6 p-6 md:max-w-6xl md:p-8">
      <div className="flex flex-col md:border-b md:pb-4">
        <Link
          href={`/databases/${db}/tables/${table}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {table} のレコード一覧
        </Link>
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between md:gap-3">
          <h1 className="text-xl font-semibold md:text-2xl">
            {table} の{isView ? "定義" : "構造"}
          </h1>
          {/* SQL出力は SHOW CREATE TABLE を使うため、SHOW VIEW 権限のないビューでは出さない。 */}
          {!isView && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <Link
                href={`/api/databases/${db}/tables/${table}/export/sql`}
                className="text-primary text-sm whitespace-nowrap underline underline-offset-2 hover:no-underline"
              >
                構造をSQL出力
              </Link>
              <Link
                href={`/api/databases/${db}/tables/${table}/export/sql?withData=1`}
                className="text-primary text-sm whitespace-nowrap underline underline-offset-2 hover:no-underline"
              >
                構造+データをSQL出力
              </Link>
            </div>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {canManageSchema && (
        <SchemaChangeNotice verified={reauthVerified} returnTo={structurePath} />
      )}

      {isView && (
        <section className="flex min-w-0 flex-col gap-2">
          <h2 className="font-medium">ビュー定義</h2>
          <p className="text-muted-foreground text-sm">
            これはビューです。閲覧のみ可能で、カラム・インデックスの変更や削除はできません。
          </p>
          {viewDefinition ? (
            <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 text-xs">
              {viewDefinition}
            </pre>
          ) : (
            <p className="text-muted-foreground rounded-md border px-3 py-2 text-sm">
              接続ロールに SHOW VIEW 権限がないため、定義を表示できません。
            </p>
          )}
        </section>
      )}

      <section className="flex min-w-0 flex-col gap-2">
        <h2 className="font-medium">カラム</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-medium">カラム名</th>
                <th className="px-3 py-2 text-left font-medium">型</th>
                <th className="px-3 py-2 text-left font-medium">NULL</th>
                <th className="px-3 py-2 text-left font-medium">デフォルト</th>
                <th className="px-3 py-2 text-left font-medium">キー</th>
                <th className="px-3 py-2 text-left font-medium">その他</th>
                {canManageSchema && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {columns.map((column) => (
                <tr key={column.name} className="border-b last:border-0 hover:bg-accent/50">
                  <td className="px-3 py-2 font-medium">{column.name}</td>
                  <td className="px-3 py-2">{column.columnType}</td>
                  <td className="px-3 py-2">{column.isNullable ? "YES" : "NO"}</td>
                  <td className="px-3 py-2">{column.columnDefault ?? "-"}</td>
                  <td className="px-3 py-2">{column.columnKey || "-"}</td>
                  <td className="px-3 py-2">{column.extra || "-"}</td>
                  {canManageSchema && (
                    <td className="px-3 py-2">
                      <form action={dropColumnAction} className="flex items-center gap-1">
                        <input type="hidden" name="__db" value={db} />
                        <input type="hidden" name="__table" value={table} />
                        <input type="hidden" name="columnName" value={column.name} />
                        <input
                          type="text"
                          name="confirmName"
                          placeholder="カラム名を入力"
                          required
                          className="w-28 rounded-md border px-2 py-1 text-xs"
                        />
                        <SchemaChangeConfirmButton
                          title="カラム削除の確認"
                          description={`${db} の ${table} テーブルからカラムを削除します。`}
                          reauthVerified={reauthVerified}
                          tone="danger"
                          fields={[
                            { label: "操作", value: "カラムを削除" },
                            { label: "テーブル", value: table },
                            { label: "カラム名", field: "columnName" },
                            { label: "型", value: column.columnType },
                          ]}
                          className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                        >
                          削除
                        </SchemaChangeConfirmButton>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canManageSchema && (
          <div className="flex flex-col gap-2">
            {columns.map((column) => (
              <details key={column.name} className="rounded-md border p-2">
                <summary className="cursor-pointer text-sm font-medium">
                  {column.name} を編集
                </summary>
                <form
                  action={modifyColumnAction}
                  className="mt-2 flex flex-col items-end gap-2"
                >
                  <input type="hidden" name="__db" value={db} />
                  <input type="hidden" name="__table" value={table} />
                  <input type="hidden" name="columnName" value={column.name} />
                  <ColumnEditFields
                    column={column}
                    options={COLUMN_TYPE_OPTIONS}
                    otherColumnNames={columns
                      .filter((c) => c.name !== column.name)
                      .map((c) => c.name)}
                  />
                  <SchemaChangeConfirmButton
                    title="カラム変更の確認"
                    description={`${db} の ${table} テーブルのカラムを変更します。型を狭めるとデータが失われる場合があります。`}
                    reauthVerified={reauthVerified}
                    fields={[
                      { label: "操作", value: "カラムを変更" },
                      { label: "テーブル", value: table },
                      { label: "カラム名", value: column.name },
                      { label: "型", field: "typeKey", kind: "select" },
                      { label: "パラメータ1", field: "param1", empty: "なし" },
                      { label: "パラメータ2", field: "param2", empty: "なし" },
                      {
                        label: "NULL許可",
                        field: "nullable",
                        kind: "checkbox",
                        checkedLabel: "許可する",
                        uncheckedLabel: "許可しない",
                      },
                      { label: "デフォルト", field: "defaultValue" },
                      { label: "コメント", field: "comment" },
                    ]}
                    className="min-h-11 rounded-md border px-3 text-sm hover:bg-accent"
                  >
                    保存
                  </SchemaChangeConfirmButton>
                </form>
              </details>
            ))}
          </div>
        )}

        {canManageSchema && (
          <form
            action={addColumnAction}
            className="flex flex-wrap items-end gap-2 rounded-lg border p-3"
          >
            <input type="hidden" name="__db" value={db} />
            <input type="hidden" name="__table" value={table} />
            <label className="flex flex-col gap-1 text-xs">
              カラム名
              <input
                type="text"
                name="columnName"
                required
                className="rounded-md border px-2 py-1 text-sm"
              />
            </label>
            <ColumnTypeSelectFields options={COLUMN_TYPE_OPTIONS} />
            <label className="flex flex-col gap-1 text-xs">
              デフォルト値
              <input
                type="text"
                name="defaultValue"
                className="w-32 rounded-md border px-2 py-1 text-sm"
              />
            </label>
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" name="nullable" defaultChecked className="h-4 w-4" />
              NULL許可
            </label>
            <SchemaChangeConfirmButton
              title="カラム追加の確認"
              description={`${db} の ${table} テーブルにカラムを追加します。`}
              reauthVerified={reauthVerified}
              fields={[
                { label: "操作", value: "カラムを追加" },
                { label: "テーブル", value: table },
                { label: "カラム名", field: "columnName" },
                { label: "型", field: "typeKey", kind: "select" },
                { label: "パラメータ1", field: "param1", empty: "なし" },
                { label: "パラメータ2", field: "param2", empty: "なし" },
                {
                  label: "NULL許可",
                  field: "nullable",
                  kind: "checkbox",
                  checkedLabel: "許可する",
                  uncheckedLabel: "許可しない",
                },
                { label: "デフォルト", field: "defaultValue" },
              ]}
              className="min-h-11 rounded-md border px-3 text-sm hover:bg-accent"
            >
              カラム追加
            </SchemaChangeConfirmButton>
          </form>
        )}
      </section>

      {!isView && (
        <section className="flex min-w-0 flex-col gap-2">
          <h2 className="font-medium">インデックス</h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium">インデックス名</th>
                  <th className="px-3 py-2 text-left font-medium">種別</th>
                  <th className="px-3 py-2 text-left font-medium">カラム</th>
                  {canManageSchema && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {indexes.map((index) => (
                  <tr key={index.name} className="border-b last:border-0 hover:bg-accent/50">
                    <td className="px-3 py-2 font-medium">{index.name}</td>
                    <td className="px-3 py-2">
                      {index.name === "PRIMARY" ? "PRIMARY KEY" : index.unique ? "UNIQUE" : "INDEX"}
                    </td>
                    <td className="px-3 py-2">{index.columns.join(", ")}</td>
                    {canManageSchema && (
                      <td className="px-3 py-2">
                        <form action={dropIndexAction} className="flex items-center gap-1">
                          <input type="hidden" name="__db" value={db} />
                          <input type="hidden" name="__table" value={table} />
                          <input type="hidden" name="indexName" value={index.name} />
                          <input
                            type="text"
                            name="confirmName"
                            placeholder="インデックス名を入力"
                            required
                            className="w-32 rounded-md border px-2 py-1 text-xs"
                          />
                          <SchemaChangeConfirmButton
                            title="インデックス削除の確認"
                            description={`${db} の ${table} テーブルからインデックスを削除します。`}
                            reauthVerified={reauthVerified}
                            tone="danger"
                            fields={[
                              { label: "操作", value: "インデックスを削除" },
                              { label: "テーブル", value: table },
                              { label: "インデックス名", field: "indexName" },
                              { label: "対象カラム", value: index.columns.join(", ") },
                            ]}
                            className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                          >
                            削除
                          </SchemaChangeConfirmButton>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
                {indexes.length === 0 && (
                  <tr>
                    <td
                      colSpan={canManageSchema ? 4 : 3}
                      className="text-muted-foreground px-3 py-6 text-center"
                    >
                      インデックスがありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {canManageSchema && (
            <form
              action={addIndexAction}
              className="flex flex-wrap items-end gap-2 rounded-lg border p-3"
            >
              <input type="hidden" name="__db" value={db} />
              <input type="hidden" name="__table" value={table} />
              <label className="flex flex-col gap-1 text-xs">
                種別
                <select name="kind" className="rounded-md border px-2 py-1 text-sm">
                  <option value="index">通常インデックス</option>
                  <option value="unique">UNIQUE</option>
                  <option value="primary">PRIMARY KEY</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                インデックス名（PRIMARYの場合は不要）
                <input
                  type="text"
                  name="indexName"
                  className="w-40 rounded-md border px-2 py-1 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                対象カラム（カンマ区切り、複合可）
                <input
                  type="text"
                  name="columns"
                  required
                  placeholder="例: user_id,created_at"
                  className="w-56 rounded-md border px-2 py-1 text-sm"
                />
              </label>
              <SchemaChangeConfirmButton
                title="インデックス追加の確認"
                description={`${db} の ${table} テーブルにインデックスを追加します。`}
                reauthVerified={reauthVerified}
                fields={[
                  { label: "操作", value: "インデックスを追加" },
                  { label: "テーブル", value: table },
                  { label: "種別", field: "kind", kind: "select" },
                  { label: "インデックス名", field: "indexName", empty: "自動（PRIMARY）" },
                  { label: "対象カラム", field: "columns" },
                ]}
                className="min-h-11 rounded-md border px-3 text-sm hover:bg-accent"
              >
                インデックス追加
              </SchemaChangeConfirmButton>
            </form>
          )}
        </section>
      )}

      {canManageSchema && (
        <section className="flex flex-col gap-4 rounded-lg border p-4">
          <h2 className="font-medium">テーブル管理</h2>

          <form action={renameTableAction} className="flex flex-col gap-2">
            <input type="hidden" name="__db" value={db} />
            <input type="hidden" name="__table" value={table} />
            <label className="flex flex-col gap-1 text-sm">
              テーブル名変更
              <input
                type="text"
                name="newName"
                defaultValue={table}
                required
                className="rounded-md border px-3 py-2"
              />
            </label>
            <div className="flex justify-end">
              <SchemaChangeConfirmButton
                title="テーブル名変更の確認"
                description={`${db} の ${table} テーブルの名前を変更します。`}
                reauthVerified={reauthVerified}
                fields={[
                  { label: "操作", value: "テーブル名を変更" },
                  { label: "現在の名前", value: table },
                  { label: "新しい名前", field: "newName" },
                ]}
                className="min-h-11 rounded-md border px-3 text-sm hover:bg-accent"
              >
                名前を変更
              </SchemaChangeConfirmButton>
            </div>
          </form>

          <div className="flex justify-end border-t pt-3">
            <Link
              href={`/databases/${db}/tables/${table}/danger`}
              className="text-sm text-red-600 hover:underline"
            >
              空データ化・削除はこちら →
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
