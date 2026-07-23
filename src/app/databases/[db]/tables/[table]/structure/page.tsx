import Link from "next/link";
import { notFound } from "next/navigation";

import { getDatabaseEntry, modeAtLeast } from "@/lib/config";
import { getTableColumns, getTableIndexes } from "@/lib/introspection";
import { IdentifierNotFoundError } from "@/lib/identifier";
import { requireSessionForPage } from "@/lib/session";
import { renameTableAction } from "../schema-actions";

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
  const canManageSchema = modeAtLeast(entry.mode, "schema-write");

  let columns, indexes;
  try {
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

  return (
    <main className="mx-auto flex max-w-4xl flex-1 flex-col gap-6 p-6">
      <div className="flex flex-col">
        <Link
          href={`/databases/${db}/tables/${table}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {table} のレコード一覧
        </Link>
        <h1 className="text-xl font-semibold">{table} の構造</h1>
      </div>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <section className="flex flex-col gap-2">
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
              </tr>
            </thead>
            <tbody>
              {columns.map((column) => (
                <tr key={column.name} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{column.name}</td>
                  <td className="px-3 py-2">{column.columnType}</td>
                  <td className="px-3 py-2">{column.isNullable ? "YES" : "NO"}</td>
                  <td className="px-3 py-2">{column.columnDefault ?? "-"}</td>
                  <td className="px-3 py-2">{column.columnKey || "-"}</td>
                  <td className="px-3 py-2">{column.extra || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">インデックス</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-medium">インデックス名</th>
                <th className="px-3 py-2 text-left font-medium">種別</th>
                <th className="px-3 py-2 text-left font-medium">カラム</th>
              </tr>
            </thead>
            <tbody>
              {indexes.map((index) => (
                <tr key={index.name} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{index.name}</td>
                  <td className="px-3 py-2">{index.unique ? "UNIQUE" : "INDEX"}</td>
                  <td className="px-3 py-2">{index.columns.join(", ")}</td>
                </tr>
              ))}
              {indexes.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-muted-foreground px-3 py-6 text-center">
                    インデックスがありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

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
              <button
                type="submit"
                className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
              >
                名前を変更
              </button>
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
