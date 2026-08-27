import Link from "next/link";
import { notFound } from "next/navigation";

import { getDatabaseEntry, modeAtLeast } from "@/lib/config";
import { getTableColumns, getTableKind, getRowByPrimaryKey } from "@/lib/introspection";
import { requireSessionForPage } from "@/lib/session";
import { RowFormFields } from "@/components/row-form-fields";
import { updateRowAction } from "../actions";

function decodePk(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // ignore
  }
  return {};
}

export default async function EditRowPage({
  params,
  searchParams,
}: {
  params: Promise<{ db: string; table: string }>;
  searchParams: Promise<{ pk?: string; error?: string }>;
}) {
  await requireSessionForPage();
  const { db, table } = await params;
  const { pk: pkRaw, error } = await searchParams;

  const entry = await getDatabaseEntry(db);
  if (!entry || !modeAtLeast(entry.mode, "data-write") || !pkRaw) {
    notFound();
  }

  // ビューはレコードを更新できないため、URLを直接叩かれても編集画面を出さない。
  if ((await getTableKind(db, table)) === "view") {
    notFound();
  }

  const pkValues = decodePk(pkRaw);
  const columns = await getTableColumns(db, table);
  const row = await getRowByPrimaryKey(db, table, pkValues);
  if (!row) {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-2xl flex-1 flex-col gap-4 p-6">
      <Link
        href={`/databases/${db}/tables/${table}`}
        className="text-muted-foreground text-sm hover:underline"
      >
        ← {table} のレコード一覧
      </Link>
      <h1 className="text-xl font-semibold">{table} のレコードを編集</h1>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <form action={updateRowAction} className="flex flex-col gap-3">
        <input type="hidden" name="__db" value={db} />
        <input type="hidden" name="__table" value={table} />
        <input type="hidden" name="__pk" value={pkRaw} />
        <RowFormFields columns={columns} initialValues={row} />
        <div className="flex justify-end">
          <button
            type="submit"
            className="min-h-11 rounded-md border px-4 py-2 text-sm hover:bg-accent"
          >
            保存
          </button>
        </div>
      </form>
    </main>
  );
}
