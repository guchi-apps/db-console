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
} from "./actions";

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
    <main className="mx-auto flex w-full min-w-0 max-w-2xl flex-1 flex-col gap-6 p-6 md:max-w-6xl md:p-8">
      <div className="flex flex-col gap-1 md:border-b md:pb-4">
        {/* md以上はサイドバーに同じ導線があるため出さない。 */}
        <div className="flex items-center justify-between md:hidden">
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
        <h1 className="text-xl font-semibold md:text-2xl">設定: 管理対象データベース</h1>
        <p className="text-muted-foreground text-sm">{session.user.email} でログイン中</p>
        <p className="text-muted-foreground text-sm">
          「{MANAGED_NAME_PREFIX}」で始まるDBは、この画面を開いた時点で権限付与まで含めて自動的に
          管理対象へ登録されます（新規作成もこの画面から行えます）。それ以外の既存DBは、MariaDB側で
          db_console_data / db_console_schema へGRANT済みのものだけを「既存DBを登録」から追加できます。
          削除したDBは自動登録の対象から外れ、戻したいときは「既存DBを登録」から登録し直せます。
        </p>
        <p className="text-muted-foreground text-sm">
          管理対象のDBは、レコードの編集も構造の変更も行えます。テーブル・カラム・インデックスを
          変更するときだけ、実行前に内容の確認とGoogleアカウントでの本人確認を求めます。
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* lg以上は「登録済みDBの編集」と「追加・アプリ情報」を左右に分ける。 */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-6">
          <h2 className="font-medium">管理対象データベース</h2>

          <ul className="flex flex-col gap-3">
            {databases.map((entry) => (
              <li
                key={entry.name}
                className="flex items-center justify-between gap-3 rounded-lg border p-4"
              >
                <span className="min-w-0 truncate font-medium">{entry.name}</span>
                <DeleteManagedDatabaseButton
                  action={deleteManagedDatabaseAction}
                  name={entry.name}
                />
              </li>
            ))}
            {databases.length === 0 && (
              <li className="text-muted-foreground text-sm">
                管理対象データベースが登録されていません
              </li>
            )}
          </ul>
        </div>

        <div className="flex flex-col gap-6">
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
                <p className="text-muted-foreground text-xs">
                  utf8mb4 / utf8mb4_unicode_ci で作成し、db_console_data と db_console_schema の
                  両方へ権限を付与します。
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
        </div>
      </div>
    </main>
  );
}
