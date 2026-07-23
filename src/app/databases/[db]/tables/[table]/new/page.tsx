import Link from "next/link";
import { notFound } from "next/navigation";

import { getDatabaseEntry, modeAtLeast } from "@/lib/config";
import { getTableColumns } from "@/lib/introspection";
import { requireSessionForPage } from "@/lib/session";
import { RowFormFields } from "@/components/row-form-fields";
import { createRowAction } from "../actions";

export default async function NewRowPage({
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
  if (!entry || !modeAtLeast(entry.mode, "data-write")) {
    notFound();
  }

  const columns = await getTableColumns(db, table);

  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col gap-4 p-6">
      <Link
        href={`/databases/${db}/tables/${table}`}
        className="text-muted-foreground text-sm hover:underline"
      >
        ← {table} のレコード一覧
      </Link>
      <h1 className="text-xl font-semibold">{table} にレコードを追加</h1>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <form action={createRowAction} className="flex flex-col gap-3">
        <input type="hidden" name="__db" value={db} />
        <input type="hidden" name="__table" value={table} />
        <RowFormFields columns={columns} />
        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
          >
            追加
          </button>
        </div>
      </form>
    </main>
  );
}
