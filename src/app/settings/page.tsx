import Link from "next/link";

import { getDatabasesConfig } from "@/lib/config";
import { requireSessionForPage } from "@/lib/session";
import { listRegistrableDatabaseNames } from "@/lib/target-db";
import { DeleteManagedDatabaseButton } from "@/components/delete-managed-database-button";
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
  const session = await requireSessionForPage();
  const { error } = await searchParams;
  const databases = await getDatabasesConfig();
  const registeredNames = new Set(databases.map((entry) => entry.name));
  const registrableNames = (await listRegistrableDatabaseNames()).filter(
    (name) => !registeredNames.has(name),
  );

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-2xl flex-1 flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-muted-foreground text-sm hover:underline">
            ← データベース一覧
          </Link>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="text-muted-foreground min-h-11 text-sm hover:underline"
            >
              ログアウト
            </button>
          </form>
        </div>
        <h1 className="text-xl font-semibold">設定: 管理対象データベース</h1>
        <p className="text-muted-foreground text-sm">{session.user.email} でログイン中</p>
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

      <h2 className="font-medium">管理対象データベース</h2>

      <ul className="flex flex-col gap-3">
        {databases.map((entry) => (
          <li key={entry.name} className="flex flex-col gap-3 rounded-lg border p-4">
            <span className="text-muted-foreground text-sm">{entry.name}</span>
            <form
              id={`update-db-${entry.name}`}
              action={updateManagedDatabaseAction}
              className="flex flex-col gap-2"
            >
              <input type="hidden" name="name" value={entry.name} />
              <input
                name="label"
                defaultValue={entry.label}
                required
                className="rounded-md border px-3 py-2 text-sm"
                aria-label="表示名"
              />
            </form>
            <div className="flex justify-between gap-3">
              <select
                name="mode"
                form={`update-db-${entry.name}`}
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
              <div className="flex gap-3">
                <button
                  type="submit"
                  form={`update-db-${entry.name}`}
                  className="min-h-11 rounded-md border px-3 text-sm hover:bg-accent"
                >
                  保存
                </button>
                <DeleteManagedDatabaseButton
                  action={deleteManagedDatabaseAction}
                  name={entry.name}
                  label={entry.label}
                />
              </div>
            </div>
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
        {registrableNames.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            db_console_data / db_console_schema ロールがGRANTされている、未登録のDBが見つかりません。
            先にMariaDB側でGRANTを行ってください。
          </p>
        ) : (
          <form action={createManagedDatabaseAction} className="flex flex-col gap-2">
            <select
              name="name"
              required
              defaultValue=""
              className="rounded-md border px-3 py-2 text-sm"
              aria-label="DB名"
            >
              <option value="" disabled>
                DBを選択
              </option>
              {registrableNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
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
                className="min-h-11 rounded-md border px-3 text-sm hover:bg-accent"
              >
                追加
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
