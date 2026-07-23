import Link from "next/link";
import { notFound } from "next/navigation";

import { getDatabaseEntry } from "@/lib/config";
import { getTableRows } from "@/lib/introspection";
import { IdentifierNotFoundError } from "@/lib/identifier";
import { requireSessionForPage } from "@/lib/session";

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
  }>;
}) {
  await requireSessionForPage();
  const { db, table } = await params;
  const query = await searchParams;

  const entry = getDatabaseEntry(db);
  if (!entry) {
    notFound();
  }

  const page = Number(query.page ?? "1") || 1;
  const sortDirection = query.sortDirection === "desc" ? "desc" : "asc";

  let result;
  try {
    result = await getTableRows(db, table, {
      page,
      sortColumn: query.sortColumn,
      sortDirection,
      search: query.search,
    });
  } catch (error) {
    if (error instanceof IdentifierNotFoundError) {
      notFound();
    }
    throw error;
  }

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

      <form className="flex gap-2" action="" method="get">
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

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
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
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i} className="border-b last:border-0">
                {result.columns.map((column) => (
                  <td key={column} className="px-3 py-2 whitespace-nowrap">
                    {formatCellValue(row[column])}
                  </td>
                ))}
              </tr>
            ))}
            {result.rows.length === 0 && (
              <tr>
                <td
                  colSpan={result.columns.length || 1}
                  className="text-muted-foreground px-3 py-6 text-center"
                >
                  レコードがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
