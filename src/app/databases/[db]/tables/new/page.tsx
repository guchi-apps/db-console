import Link from "next/link";
import { notFound } from "next/navigation";

import { getDatabaseEntry } from "@/lib/config";
import { requireSessionForPage } from "@/lib/session";
import { isReauthValid } from "@/lib/reauth";
import { COLUMN_TYPE_OPTIONS } from "@/lib/column-types";
import { ColumnTypeFields } from "@/components/column-type-fields";
import { SchemaChangeConfirmButton } from "@/components/schema-change-confirm-button";
import { SchemaChangeNotice } from "@/components/schema-change-notice";
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
  if (!entry) {
    notFound();
  }

  const reauthVerified = await isReauthValid();

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-4xl flex-1 flex-col gap-4 p-6 md:p-8">
      <Link
        href={`/databases/${db}/tables`}
        className="text-muted-foreground text-sm hover:underline"
      >
        ← {entry.name} のテーブル一覧
      </Link>
      <h1 className="text-xl font-semibold md:text-2xl">テーブルを作成</h1>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <SchemaChangeNotice verified={reauthVerified} returnTo={`/databases/${db}/tables/new`} />

      <form action={createTableAction} className="flex min-w-0 flex-col gap-4">
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
                  <ColumnTypeFields index={i} options={COLUMN_TYPE_OPTIONS} />
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
          <SchemaChangeConfirmButton
            title="テーブル作成の確認"
            description={`${db} にテーブルを作成します。`}
            reauthVerified={reauthVerified}
            fields={[
              { label: "操作", value: "テーブルを作成" },
              { label: "データベース", value: db },
              { label: "テーブル名", field: "tableName" },
            ]}
            className="min-h-11 rounded-md border px-4 py-2 text-sm hover:bg-accent"
          >
            テーブルを作成
          </SchemaChangeConfirmButton>
        </div>
      </form>
    </main>
  );
}
