import Link from "next/link";
import { notFound } from "next/navigation";

import { getDatabaseEntry, modeAtLeast } from "@/lib/config";
import { getPrimaryKeyColumns, getTableRows } from "@/lib/introspection";
import { IdentifierNotFoundError } from "@/lib/identifier";
import { requireSessionForPage } from "@/lib/session";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { deleteRowsAction } from "./actions";

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `0x${value.toString("hex")}`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default async function TableRowsPage({
  params,
  searchParams,
}: {
  params: Promise<{ db: string; table: string }>;
  searchParams: Promise<{
    page?: string;
    sortColumn?: string;
    sortDirection?: string;
    search?: string;
    error?: string;
  }>;
}) {
  await requireSessionForPage();
  const { db, table } = await params;
  const query = await searchParams;

  const entry = await getDatabaseEntry(db);
  if (!entry) {
    notFound();
  }

  const canWrite = modeAtLeast(entry.mode, "data-write");

  const page = Number(query.page ?? "1") || 1;
  const sortDirection = query.sortDirection === "desc" ? "desc" : "asc";

  let result;
  let pkColumns: string[] = [];
  try {
    result = await getTableRows(db, table, {
      page,
      sortColumn: query.sortColumn,
      sortDirection,
      search: query.search,
    });
    pkColumns = await getPrimaryKeyColumns(db, table);
  } catch (error) {
    if (error instanceof IdentifierNotFoundError) {
      notFound();
    }
    throw error;
  }

  const canEditRows = canWrite && pkColumns.length > 0;
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  function buildQuery(overrides: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    const merged = { ...query, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-1 flex-col gap-4 p-6">
      <div className="flex flex-col">
        <Link
          href={`/databases/${db}/tables`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {entry.label} のテーブル一覧
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">{table}</h1>
          <Link
            href={`/databases/${db}/tables/${table}/structure`}
            className="text-muted-foreground text-sm hover:underline"
          >
            テーブル構造を見る
          </Link>
        </div>
      </div>

      {query.error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {query.error}
        </p>
      )}

      {canWrite && !canEditRows && (
        <p className="text-muted-foreground rounded-md border px-3 py-2 text-sm">
          このテーブルには主キーがないため、個別のレコード編集・削除はできません。
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <form className="flex flex-1 gap-2" action="" method="get">
          <input
            type="text"
            name="search"
            defaultValue={query.search ?? ""}
            placeholder="キーワード検索"
            className="flex-1 rounded-md border px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
          >
            検索
          </button>
        </form>
        {canWrite && (
          <Link
            href={`/databases/${db}/tables/${table}/new`}
            className="rounded-md border px-4 py-2 text-sm whitespace-nowrap hover:bg-accent"
          >
            + 追加
          </Link>
        )}
      </div>

      <form action={deleteRowsAction}>
        <input type="hidden" name="__db" value={db} />
        <input type="hidden" name="__table" value={table} />

        {canEditRows && (
          <div className="mb-2 flex justify-end">
            <ConfirmSubmitButton
              confirmMessage="選択したレコードを削除しますか？この操作は取り消せません。"
              className="rounded-md border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50"
            >
              選択したレコードを削除
            </ConfirmSubmitButton>
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {canEditRows && <th className="px-3 py-2" />}
                {result.columns.map((column) => {
                  const isSorted = query.sortColumn === column;
                  const nextDirection =
                    isSorted && sortDirection === "asc" ? "desc" : "asc";
                  return (
                    <th key={column} className="px-3 py-2 text-left font-medium">
                      <Link
                        href={buildQuery({
                          sortColumn: column,
                          sortDirection: nextDirection,
                          page: undefined,
                        })}
                        className="hover:underline"
                      >
                        {column}
                        {isSorted ? (sortDirection === "asc" ? " ▲" : " ▼") : ""}
                      </Link>
                    </th>
                  );
                })}
                {canEditRows && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => {
                const pkValues = Object.fromEntries(
                  pkColumns.map((col) => [col, formatCellValue(row[col])]),
                );
                const pkJson = JSON.stringify(pkValues);
                return (
                  <tr key={i} className="border-b last:border-0">
                    {canEditRows && (
                      <td className="px-3 py-2">
                        <input type="checkbox" name="__pk" value={pkJson} />
                      </td>
                    )}
                    {result.columns.map((column) => (
                      <td key={column} className="px-3 py-2 whitespace-nowrap">
                        {formatCellValue(row[column])}
                      </td>
                    ))}
                    {canEditRows && (
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Link
                          href={`/databases/${db}/tables/${table}/edit?pk=${encodeURIComponent(pkJson)}`}
                          className="text-sm hover:underline"
                        >
                          編集
                        </Link>
                      </td>
                    )}
                  </tr>
                );
              })}
              {result.rows.length === 0 && (
                <tr>
                  <td
                    colSpan={result.columns.length + (canEditRows ? 2 : 0) || 1}
                    className="text-muted-foreground px-3 py-6 text-center"
                  >
                    レコードがありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </form>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          全 {result.total} 件中 {(page - 1) * result.pageSize + 1}
          〜{Math.min(page * result.pageSize, result.total)} 件
        </span>
        <div className="flex gap-2">
          <Link
            href={buildQuery({ page: String(Math.max(1, page - 1)) })}
            aria-disabled={page <= 1}
            className="rounded-md border px-3 py-1 hover:bg-accent aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            前へ
          </Link>
          <span className="text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Link
            href={buildQuery({ page: String(Math.min(totalPages, page + 1)) })}
            aria-disabled={page >= totalPages}
            className="rounded-md border px-3 py-1 hover:bg-accent aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            次へ
          </Link>
        </div>
      </div>
    </main>
  );
}
