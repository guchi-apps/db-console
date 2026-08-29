import Link from "next/link";

import { MANAGED_NAME_PREFIX, getDatabasesConfig, isManagedName } from "@/lib/config";
import { isAdminRoleConfigured } from "@/lib/admin-db";
import {
  PRIVILEGE_PRESETS,
  PRIVILEGE_PRESET_LABELS,
  USER_HOSTS,
  USER_HOST_LABELS,
  listDatabaseUsers,
  type DatabaseUserAccount,
} from "@/lib/db-users";
import { requireSessionForPage } from "@/lib/session";
import { DbUserCreateForm } from "@/components/db-user-create-form";
import { DbUserPasswordResetForm } from "@/components/db-user-password-reset-form";
import { DeleteDatabaseUserButton } from "@/components/delete-database-user-button";
import { dropDatabaseUserAction, updateDatabaseUserPrivilegeAction } from "./actions";

export default async function DatabaseUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireSessionForPage();
  const { error } = await searchParams;
  const configured = isAdminRoleConfigured();

  const databases = await getDatabasesConfig();
  // 管理ロールが GRANT できるのは `app\_%` に限られるため、権限変更の対象も
  // app_ で始まる管理対象DBだけにする。
  const grantableDatabases = databases.filter((entry) => isManagedName(entry.name));

  let users: DatabaseUserAccount[] = [];
  let listError: string | null = null;
  if (configured) {
    try {
      users = await listDatabaseUsers();
    } catch (e) {
      listError = e instanceof Error ? e.message : "ユーザー一覧を取得できませんでした";
    }
  }

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-2xl flex-1 flex-col gap-6 p-6 md:max-w-6xl md:p-8">
      <div className="flex flex-col gap-1 md:border-b md:pb-4">
        <Link href="/settings" className="text-muted-foreground text-sm hover:underline">
          ← 設定
        </Link>
        <h1 className="text-xl font-semibold md:text-2xl">設定: DBユーザー</h1>
        <p className="text-muted-foreground text-sm">
          MariaDB上の「{MANAGED_NAME_PREFIX}」で始まるアカウントだけを扱います。パスワードは
          保存しないため、作成・再発行の直後に1度だけ表示します。
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {!configured && (
        <p className="rounded-md border px-3 py-2 text-sm">
          管理ロール（DB_CONSOLE_ADMIN_USER / DB_CONSOLE_ADMIN_PASSWORD）が未設定のため、
          この画面からの操作はできません。MariaDB側でロールを作成し、環境変数を設定してください。
        </p>
      )}

      {listError && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {listError}
        </p>
      )}

      {configured && (
        <section className="flex flex-col gap-2 rounded-lg border p-4">
          <h2 className="font-medium">ユーザーを作成</h2>
          <DbUserCreateForm
            namePrefix={MANAGED_NAME_PREFIX}
            hosts={USER_HOSTS.map((host) => ({ value: host, label: USER_HOST_LABELS[host] }))}
          />
        </section>
      )}

      {configured && (
        <>
          <h2 className="font-medium">ユーザー一覧</h2>
          <ul className="flex flex-col gap-3 xl:grid xl:grid-cols-2 xl:items-start xl:gap-4">
            {users.map((account) => {
              const key = `${account.user}@${account.host}`;
              const otherGrants = account.grants.filter(
                (grant) => !grantableDatabases.some((entry) => entry.name === grant.database),
              );

              return (
                <li key={key} className="flex flex-col gap-3 rounded-lg border p-4">
                  <span className="font-mono text-sm font-medium">{key}</span>

                  {grantableDatabases.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      権限を変更できる管理対象DB（{MANAGED_NAME_PREFIX}で始まるもの）がありません。
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {grantableDatabases.map((entry) => {
                        const grant = account.grants.find(
                          (item) => item.database === entry.name,
                        );
                        const preset = grant?.preset ?? "none";
                        const formId = `grant-${key}-${entry.name}`;
                        return (
                          <form
                            key={entry.name}
                            id={formId}
                            action={updateDatabaseUserPrivilegeAction}
                            className="flex items-center justify-between gap-3"
                          >
                            <input type="hidden" name="name" value={account.user} />
                            <input type="hidden" name="host" value={account.host} />
                            <input type="hidden" name="database" value={entry.name} />
                            <span className="min-w-0 truncate text-sm">{entry.name}</span>
                            <div className="flex shrink-0 items-center gap-2">
                              <select
                                name="preset"
                                defaultValue={preset === "custom" ? "" : preset}
                                aria-label={`${entry.name} の権限`}
                                className="rounded-md border px-2 py-2 text-sm"
                              >
                                {preset === "custom" && (
                                  <option value="" disabled>
                                    {PRIVILEGE_PRESET_LABELS.custom}
                                  </option>
                                )}
                                {PRIVILEGE_PRESETS.map((option) => (
                                  <option key={option} value={option}>
                                    {PRIVILEGE_PRESET_LABELS[option]}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="submit"
                                className="hover:bg-accent min-h-11 rounded-md border px-3 text-sm"
                              >
                                保存
                              </button>
                            </div>
                          </form>
                        );
                      })}
                    </div>
                  )}

                  {otherGrants.length > 0 && (
                    <p className="text-muted-foreground text-xs">
                      この画面の対象外のDBにも権限があります:{" "}
                      {otherGrants.map((grant) => grant.database).join(", ")}
                    </p>
                  )}

                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <DbUserPasswordResetForm name={account.user} host={account.host} />
                    <DeleteDatabaseUserButton
                      action={dropDatabaseUserAction}
                      name={account.user}
                      host={account.host}
                    />
                  </div>
                </li>
              );
            })}
            {users.length === 0 && !listError && (
              <li className="text-muted-foreground text-sm">
                「{MANAGED_NAME_PREFIX}」で始まるDBユーザーはまだありません。
              </li>
            )}
          </ul>
        </>
      )}
    </main>
  );
}
