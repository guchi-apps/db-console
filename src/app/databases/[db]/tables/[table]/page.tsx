import Link from "next/link";
import { notFound } from "next/navigation";

import { getDatabaseEntry, modeAtLeast } from "@/lib/config";
import {
  getPrimaryKeyColumns,
  getTableForeignKeys,
  getTableRows,
  type ForeignKeyInfo,
} from "@/lib/introspection";
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

/** 外部キーカラムの値は、参照先テーブルをその値で絞り込んだ一覧ページへのリンクとして表示する。 */
function CellValue({
  db,
  value,
  foreignKey,
}: {
  db: string;
  value: unknown;
  foreignKey?: ForeignKeyInfo;
}) {
  const formatted = formatCellValue(value);
  if (foreignKey && value !== null && value !== undefined) {
    const href = `/databases/${db}/tables/${foreignKey.referencedTable}?filterColumn=${encodeURIComponent(foreignKey.referencedColumn)}&filterValue=${encodeURIComponent(formatted)}`;
    return (
      <Link href={href} className="text-primary underline underline-offset-2 hover:no-underline">
        {formatted}
      </Link>
    );
  }
  return <>{formatted}</>;
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
    filterColumn?: string;
    filterValue?: string;
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
  let foreignKeys: ForeignKeyInfo[] = [];
  try {
    result = await getTableRows(db, table, {
      page,
      sortColumn: query.sortColumn,
      sortDirection,
      search: query.search,
      filterColumn: query.filterColumn,
      filterValue: query.filterValue,
    });
    pkColumns = await getPrimaryKeyColumns(db, table);
    foreignKeys = await getTableForeignKeys(db, table);
  } catch (error) {
    if (error instanceof IdentifierNotFoundError) {
      notFound();
    }
    throw error;
  }
  const fkByColumn = new Map(foreignKeys.map((fk) => [fk.columnName, fk]));

  const canEditRows = canWrite && pkColumns.length > 0;
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  function buildQuery(overrides: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    const merged = { ...query, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    return `/databases/${db}/tables/${table}${qs ? `?${qs}` : ""}`;
  }

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-4 p-6">
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
            className="text-primary text-sm underline underline-offset-2 hover:no-underline"
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

      {query.filterColumn && (
        <p className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
          <span>
            絞り込み中: {query.filterColumn} = {query.filterValue}
          </span>
          <Link
            href={buildQuery({ filterColumn: undefined, filterValue: undefined, page: undefined })}
            className="text-primary underline underline-offset-2 hover:no-underline"
          >
            解除
          </Link>
        </p>
      )}

      <div className="flex min-w-0 flex-col gap-2">
        <form className="flex min-w-0 gap-2" action="" method="get">
          <input
            type="text"
            name="search"
            defaultValue={query.search ?? ""}
            placeholder="キーワード検索"
            className="min-h-11 min-w-0 flex-1 rounded-md border px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="min-h-11 rounded-md border px-4 py-2 text-sm hover:bg-accent"
          >
            検索
          </button>
        </form>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/api/databases/${db}/tables/${table}/export/csv${
              query.search ? `?search=${encodeURIComponent(query.search)}` : ""
            }`}
            className="flex min-h-11 items-center rounded-md border px-4 py-2 text-sm whitespace-nowrap hover:bg-accent"
          >
            CSV出力
          </Link>
          {canWrite && (
            <Link
              href={`/databases/${db}/tables/${table}/new`}
              className="flex min-h-11 items-center rounded-md border px-4 py-2 text-sm whitespace-nowrap hover:bg-accent"
            >
              + 追加
            </Link>
          )}
        </div>
      </div>

      <form action="" method="get" className="flex items-center gap-2 md:hidden">
        {Object.entries(query).map(([key, value]) =>
          key === "sortColumn" || key === "sortDirection" || !value ? null : (
            <input key={key} type="hidden" name={key} value={value} />
          ),
        )}
        <select
          defaultValue={query.sortColumn ?? ""}
          name="sortColumn"
          className="min-h-11 min-w-0 flex-1 rounded-md border px-3 py-2 text-sm"
        >
          <option value="">並び替えなし</option>
          {result.columns.map((column) => (
            <option key={column} value={column}>
              {column}
            </option>
          ))}
        </select>
        <input type="hidden" name="sortDirection" value={sortDirection} />
        <button
          type="submit"
          className="flex min-h-11 items-center rounded-md border px-3 py-2 text-sm whitespace-nowrap hover:bg-accent"
        >
          適用
        </button>
        <Link
          href={buildQuery({
            sortDirection: sortDirection === "asc" ? "desc" : "asc",
            page: undefined,
          })}
          className="flex min-h-11 items-center rounded-md border px-3 py-2 text-sm whitespace-nowrap hover:bg-accent"
        >
          {sortDirection === "asc" ? "昇順 ▲" : "降順 ▼"}
        </Link>
      </form>

      <form action={deleteRowsAction} className="min-w-0">
        <input type="hidden" name="__db" value={db} />
        <input type="hidden" name="__table" value={table} />

        {canEditRows && (
          <div className="mb-2 flex justify-end">
            <ConfirmSubmitButton
              confirmMessage="選択したレコードを削除しますか？この操作は取り消せません。"
              className="min-h-11 rounded-md border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50"
            >
              選択したレコードを削除
            </ConfirmSubmitButton>
          </div>
        )}

        {/* デスクトップ: 表形式 */}
        <div className="hidden overflow-x-auto rounded-lg border md:block">
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
                        <CellValue db={db} value={row[column]} foreignKey={fkByColumn.get(column)} />
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

        {/* モバイル: カード形式 */}
        <div className="flex flex-col gap-2 md:hidden">
          {result.rows.length === 0 && (
            <p className="text-muted-foreground rounded-lg border px-3 py-6 text-center text-sm">
              レコードがありません
            </p>
          )}

          {result.rows.map((row, i) => {
            const pkValues = Object.fromEntries(
              pkColumns.map((col) => [col, formatCellValue(row[col])]),
            );
            const pkJson = JSON.stringify(pkValues);
            return (
              <div key={i} className="min-w-0 rounded-lg border p-3">
                {canEditRows && (
                  <div className="mb-2 flex items-center justify-between border-b pb-2">
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="__pk"
                        value={pkJson}
                        className="h-5 w-5"
                      />
                      選択
                    </label>
                    <Link
                      href={`/databases/${db}/tables/${table}/edit?pk=${encodeURIComponent(pkJson)}`}
                      className="flex min-h-11 items-center px-2 text-sm hover:underline"
                    >
                      編集
                    </Link>
                  </div>
                )}
                <dl className="flex flex-col gap-1.5">
                  {result.columns.map((column) => (
                    <div
                      key={column}
                      className="flex min-w-0 justify-between gap-3 text-sm"
                    >
                      <dt className="text-muted-foreground shrink-0">{column}</dt>
                      <dd className="min-w-0 text-right break-all">
                        <CellValue db={db} value={row[column]} foreignKey={fkByColumn.get(column)} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </div>
      </form>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          全 {result.total} 件中 {(page - 1) * result.pageSize + 1}
          〜{Math.min(page * result.pageSize, result.total)} 件
        </span>
        <div className="flex items-center gap-2">
          <Link
            href={buildQuery({ page: String(Math.max(1, page - 1)) })}
            aria-disabled={page <= 1}
            className="flex min-h-11 items-center rounded-md border px-3 hover:bg-accent aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            前へ
          </Link>
          <span className="text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Link
            href={buildQuery({ page: String(Math.min(totalPages, page + 1)) })}
            aria-disabled={page >= totalPages}
            className="flex min-h-11 items-center rounded-md border px-3 hover:bg-accent aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            次へ
          </Link>
        </div>
      </div>
    </main>
  );
}
