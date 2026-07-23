import Link from "next/link";
import { notFound } from "next/navigation";

import { getDatabaseEntry, modeAtLeast } from "@/lib/config";
import { getTableRows } from "@/lib/introspection";
import { requireSessionForPage } from "@/lib/session";
import { truncateTableAction, dropTableAction } from "../schema-actions";

export default async function TableDangerPage({
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
  if (!entry || !modeAtLeast(entry.mode, "schema-write")) {
    notFound();
  }

  const { total } = await getTableRows(db, table, { pageSize: 1 });

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-2xl flex-1 flex-col gap-6 p-6">
      <Link
        href={`/databases/${db}/tables/${table}/structure`}
        className="text-muted-foreground text-sm hover:underline"
      >
        ← {table} の構造
      </Link>
      <h1 className="text-xl font-semibold text-red-700">{table} の破壊的操作</h1>
      <p className="text-muted-foreground text-sm">
        現在 {total} 件のレコードがあります。以下の操作は取り消せません。実行前にGoogleでの再認証（5分以内に確認済みの場合は省略）と、テーブル名の手入力による最終確認が必要です。
      </p>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <section className="flex flex-col gap-2 rounded-lg border border-amber-300 p-4">
        <h2 className="font-medium">空データ化（TRUNCATE）</h2>
        <p className="text-muted-foreground text-sm">
          テーブル構造は残したまま、全 {total} 件のレコードを削除します。
        </p>
        <form action={truncateTableAction} className="flex flex-col gap-2">
          <input type="hidden" name="__db" value={db} />
          <input type="hidden" name="__table" value={table} />
          <label className="flex flex-col gap-1 text-sm">
            確認のためテーブル名（{table}）を入力してください
            <input
              type="text"
              name="confirmName"
              required
              className="rounded-md border px-3 py-2"
            />
          </label>
          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-md border border-amber-400 px-4 py-2 text-sm text-amber-700 hover:bg-amber-50"
            >
              空データ化を実行
            </button>
          </div>
        </form>
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-red-300 p-4">
        <h2 className="font-medium">テーブル削除（DROP TABLE）</h2>
        <p className="text-muted-foreground text-sm">
          テーブルとそのすべてのデータを完全に削除します。
        </p>
        <form action={dropTableAction} className="flex flex-col gap-2">
          <input type="hidden" name="__db" value={db} />
          <input type="hidden" name="__table" value={table} />
          <label className="flex flex-col gap-1 text-sm">
            確認のためテーブル名（{table}）を入力してください
            <input
              type="text"
              name="confirmName"
              required
              className="rounded-md border px-3 py-2"
            />
          </label>
          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-md border border-red-400 px-4 py-2 text-sm text-red-700 hover:bg-red-50"
            >
              テーブルを削除
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
