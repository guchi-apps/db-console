import Link from "next/link";

import { APP_VERSION } from "@/lib/app-version";
import { MANAGED_NAME_PREFIX, getDatabasesConfig } from "@/lib/config";
import { isAdminRoleConfigured } from "@/lib/admin-db";
import { syncManagedAppDatabases } from "@/lib/managed-db-sync";
import { requireSessionForPage } from "@/lib/session";
import { listRegistrableDatabaseNames } from "@/lib/target-db";
import { ChangelogDialog } from "@/components/changelog-dialog";
import { DeleteManagedDatabaseButton } from "@/components/delete-managed-database-button";
import {
  createDatabaseAction,
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
  const adminConfigured = isAdminRoleConfigured();
  // app_ で始まるDBは登録操作なしで管理対象に取り込む（#97）。
  await syncManagedAppDatabases(session.user.id);
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
          「{MANAGED_NAME_PREFIX}」で始まるDBは、この画面を開いた時点で権限付与まで含めて自動的に
          管理対象へ登録されます（新規作成もこの画面から行えます）。それ以外の既存DBは、MariaDB側で
          db_console_data / db_console_schema へGRANT済みのものだけを「既存DBを登録」から追加できます。
          削除したDBは自動登録の対象から外れ、戻したいときは「既存DBを登録」から登録し直せます。
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
            <span className="font-medium">{entry.name}</span>
            <form id={`update-db-${entry.name}`} action={updateManagedDatabaseAction} className="hidden">
              <input type="hidden" name="name" value={entry.name} />
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
                />
              </div>
            </div>
          </li>
        ))}
        {databases.length === 0 && (
          <li className="text-muted-foreground text-sm">管理対象データベースがありません</li>
        )}
      </ul>

      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 className="font-medium">DBを新規作成</h2>
        {adminConfigured ? (
          <form action={createDatabaseAction} className="flex flex-col gap-2">
            <input
              name="name"
              defaultValue={MANAGED_NAME_PREFIX}
              required
              placeholder={`${MANAGED_NAME_PREFIX}myapp`}
              aria-label="DB名"
              className="rounded-md border px-3 py-2 font-mono text-sm"
            />
            <select
              name="mode"
              defaultValue="data-write"
              aria-label="操作モード"
              className="rounded-md border px-3 py-2 text-sm"
            >
              {MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">
              utf8mb4 / utf8mb4_unicode_ci で作成し、選んだ操作モードに応じて
              db_console_data（構造変更可なら db_console_schema にも）へ権限を付与します。
            </p>
            <div className="flex justify-end">
              <button
                type="submit"
                className="hover:bg-accent min-h-11 rounded-md border px-3 text-sm"
              >
                作成
              </button>
            </div>
          </form>
        ) : (
          <p className="text-muted-foreground text-sm">
            管理ロール（DB_CONSOLE_ADMIN_USER / DB_CONSOLE_ADMIN_PASSWORD）が未設定のため、
            この画面からDBを作成できません。
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 className="font-medium">既存DBを登録</h2>
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

      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 className="font-medium">DBユーザー</h2>
        <p className="text-muted-foreground text-sm">
          「{MANAGED_NAME_PREFIX}」で始まるDBユーザーの作成・権限変更・削除を行います。
        </p>
        <div className="flex justify-end">
          <Link
            href="/settings/users"
            className="hover:bg-accent min-h-11 rounded-md border px-3 py-2 text-sm"
          >
            DBユーザーを管理
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="font-medium">アプリ情報</h2>
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            バージョン <span className="tabular-nums">v{APP_VERSION}</span>
          </p>
          <ChangelogDialog currentVersion={APP_VERSION} />
        </div>
      </section>
    </main>
  );
}
