import Link from "next/link";

import { getDatabasesConfig } from "@/lib/config";
import { requireSessionForPage } from "@/lib/session";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import {
  createManagedDatabaseAction,
  deleteManagedDatabaseAction,
  updateManagedDatabaseAction,
} from "./actions";

const MODE_OPTIONS = [
  { value: "read-only", label: "閲覧のみ" },
  { value: "data-write", label: "データ編集可" },
  { value: "schema-write", label: "構造変更可" },
] as const;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireSessionForPage();
  const { error } = await searchParams;
  const databases = await getDatabasesConfig();

  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <Link href="/" className="text-muted-foreground text-sm hover:underline">
          ← データベース一覧
        </Link>
        <h1 className="text-xl font-semibold">設定: 管理対象データベース</h1>
        <p className="text-muted-foreground text-sm">
          ここで管理するのは表示名・操作モードの論理的な設定のみです。実際にDBへ接続・操作できるかは
          MariaDB側の権限（db_console_data / db_console_schema ユーザーへのGRANT）に依存するため、
          新しいDBを追加する場合は事前にインフラ側で権限を付与しておく必要があります。
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {databases.map((entry) => (
          <li key={entry.name} className="flex flex-col gap-3 rounded-lg border p-4">
            <span className="text-muted-foreground text-sm">{entry.name}</span>
            <form action={updateManagedDatabaseAction} className="flex flex-col gap-2">
              <input type="hidden" name="name" value={entry.name} />
              <input
                name="label"
                defaultValue={entry.label}
                required
                className="rounded-md border px-3 py-2 text-sm"
                aria-label="表示名"
              />
              <select
                name="mode"
                defaultValue={entry.mode}
                className="rounded-md border px-3 py-2 text-sm"
                aria-label="操作モード"
              >
                {MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-3">
                <button
                  type="submit"
                  className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
                >
                  保存
                </button>
              </div>
            </form>
            <form action={deleteManagedDatabaseAction} className="flex justify-end">
              <input type="hidden" name="name" value={entry.name} />
              <ConfirmSubmitButton
                confirmMessage={`${entry.label}（${entry.name}）を管理対象から削除しますか？`}
                className="text-sm text-red-600 hover:underline"
              >
                削除
              </ConfirmSubmitButton>
            </form>
          </li>
        ))}
        {databases.length === 0 && (
          <li className="text-muted-foreground text-sm">
            管理対象データベースが登録されていません
          </li>
        )}
      </ul>

      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 className="font-medium">新規登録</h2>
        <form action={createManagedDatabaseAction} className="flex flex-col gap-2">
          <input
            name="name"
            placeholder="DB名（例: app_example）"
            required
            className="rounded-md border px-3 py-2 text-sm"
          />
          <input
            name="label"
            placeholder="表示名（例: 経費管理）"
            required
            className="rounded-md border px-3 py-2 text-sm"
          />
          <select
            name="mode"
            defaultValue="read-only"
            className="rounded-md border px-3 py-2 text-sm"
          >
            {MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
            >
              追加
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
