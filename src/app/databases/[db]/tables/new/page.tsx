import Link from "next/link";
import { notFound } from "next/navigation";

import { getDatabaseEntry, modeAtLeast } from "@/lib/config";
import { requireSessionForPage } from "@/lib/session";
import { COLUMN_TYPE_TEMPLATES } from "@/lib/column-types";
import { createTableAction } from "../actions";

const COLUMN_ROWS = 8;

export default async function NewTablePage({
  params,
  searchParams,
}: {
  params: Promise<{ db: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireSessionForPage();
  const { db } = await params;
  const { error } = await searchParams;

  const entry = await getDatabaseEntry(db);
  if (!entry || !modeAtLeast(entry.mode, "schema-write")) {
    notFound();
  }

  return (
    <main className="mx-auto flex max-w-4xl flex-1 flex-col gap-4 p-6">
      <Link
        href={`/databases/${db}/tables`}
        className="text-muted-foreground text-sm hover:underline"
      >
        ← {entry.label} のテーブル一覧
      </Link>
      <h1 className="text-xl font-semibold">テーブルを作成</h1>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <form action={createTableAction} className="flex flex-col gap-4">
        <input type="hidden" name="__db" value={db} />

        <label className="flex flex-col gap-1 text-sm">
          テーブル名
          <input
            type="text"
            name="tableName"
            required
            className="w-64 rounded-md border px-3 py-2"
          />
        </label>

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-2 py-2 text-left font-medium">カラム名</th>
                <th className="px-2 py-2 text-left font-medium">型</th>
                <th className="px-2 py-2 text-left font-medium">パラメータ1</th>
                <th className="px-2 py-2 text-left font-medium">パラメータ2</th>
                <th className="px-2 py-2 text-left font-medium">NULL許可</th>
                <th className="px-2 py-2 text-left font-medium">主キー</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: COLUMN_ROWS }).map((_, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      name={`columnName_${i}`}
                      className="w-32 rounded-md border px-2 py-1"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <select name={`typeKey_${i}`} className="rounded-md border px-2 py-1">
                      {COLUMN_TYPE_TEMPLATES.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      name={`param1_${i}`}
                      className="w-24 rounded-md border px-2 py-1"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      name={`param2_${i}`}
                      className="w-20 rounded-md border px-2 py-1"
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      name={`nullable_${i}`}
                      defaultChecked
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input type="checkbox" name={`primaryKey_${i}`} className="h-4 w-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-xs">
          カラム名が空欄の行は無視されます。パラメータ1・2の意味は選んだ型により異なります（例:
          VARCHARなら最大文字数、DECIMALなら全体桁数・小数点以下桁数、ENUMならカンマ区切りの値）。
        </p>

        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
          >
            テーブルを作成
          </button>
        </div>
      </form>
    </main>
  );
}
