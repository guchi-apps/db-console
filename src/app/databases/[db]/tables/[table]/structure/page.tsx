import Link from "next/link";
import { notFound } from "next/navigation";

import { getTableColumns, getTableIndexes } from "@/lib/introspection";
import { IdentifierNotFoundError } from "@/lib/identifier";

export default async function TableStructurePage({
  params,
}: {
  params: Promise<{ db: string; table: string }>;
}) {
  const { db, table } = await params;

  let columns, indexes;
  try {
    [columns, indexes] = await Promise.all([
      getTableColumns(db, table),
      getTableIndexes(db, table),
    ]);
  } catch (error) {
    if (error instanceof IdentifierNotFoundError) {
      notFound();
    }
    throw error;
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
    </main>
  );
}
