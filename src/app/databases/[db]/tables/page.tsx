import Link from "next/link";
import { notFound } from "next/navigation";

import { getDatabaseEntry, modeAtLeast } from "@/lib/config";
import { listTables } from "@/lib/introspection";
import { requireSessionForPage } from "@/lib/session";

export default async function TablesPage({
  params,
}: {
  params: Promise<{ db: string }>;
}) {
  await requireSessionForPage();
  const { db } = await params;
  const entry = await getDatabaseEntry(db);
  if (!entry) {
    notFound();
  }

  const tables = await listTables(db);
  const canCreateTable = modeAtLeast(entry.mode, "schema-write");

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-2xl flex-1 flex-col gap-4 p-6">
      <div className="flex flex-col">
        <Link href="/" className="text-muted-foreground text-sm hover:underline">
          ← データベース一覧
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">{entry.label}</h1>
          <div className="flex gap-2">
            <Link
              href={`/databases/${db}/sql`}
              className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
            >
              SQL実行
            </Link>
            {canCreateTable && (
              <Link
                href={`/databases/${db}/tables/new`}
                className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
              >
                + テーブル作成
              </Link>
            )}
          </div>
        </div>
        <span className="text-muted-foreground text-sm">{entry.name}</span>
      </div>

      <ul className="flex flex-col gap-2">
        {tables.map((table) => (
          <li key={table.name}>
            <Link
              href={`/databases/${db}/tables/${table.name}`}
              className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent"
            >
              <span className="font-medium">{table.name}</span>
              <span className="text-muted-foreground text-xs">
                {table.approximateRowCount ?? "-"} 件（概算）
              </span>
            </Link>
          </li>
        ))}
        {tables.length === 0 && (
          <li className="text-muted-foreground text-sm">テーブルがありません</li>
        )}
      </ul>
    </main>
  );
}
