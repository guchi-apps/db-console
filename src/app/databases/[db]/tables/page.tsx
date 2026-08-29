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
    <main className="mx-auto flex w-full min-w-0 max-w-2xl flex-1 flex-col gap-4 p-6 md:max-w-5xl md:gap-6 md:p-8">
      <div className="flex flex-col md:border-b md:pb-4">
        {/* md以上はサイドバーからDBを切り替えられるため出さない。 */}
        <Link href="/" className="text-muted-foreground text-sm hover:underline md:hidden">
          ← データベース一覧
        </Link>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold md:text-2xl">{entry.name}</h1>
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
      </div>

      <ul className="flex flex-col gap-2 md:grid md:grid-cols-2 md:gap-3 xl:grid-cols-3">
        {tables.map((table) => (
          <li key={table.name}>
            <Link
              href={`/databases/${db}/tables/${table.name}`}
              className="flex items-center justify-between gap-2 rounded-lg border p-3 hover:bg-accent md:h-full md:flex-col md:items-start md:gap-2 md:p-4"
            >
              <span className="flex min-w-0 max-w-full items-center gap-2">
                <span className="truncate font-medium">{table.name}</span>
                {table.kind === "view" && (
                  <span className="shrink-0 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs text-sky-700">
                    ビュー
                  </span>
                )}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {table.kind === "view"
                  ? "閲覧のみ"
                  : `${table.approximateRowCount ?? "-"} 件（概算）`}
              </span>
            </Link>
          </li>
        ))}
        {tables.length === 0 && (
          <li className="text-muted-foreground text-sm">テーブル・ビューがありません</li>
        )}
      </ul>
    </main>
  );
}
