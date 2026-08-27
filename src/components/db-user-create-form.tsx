"use client";

import { useActionState } from "react";

import { DbUserPasswordNotice } from "@/components/db-user-password-notice";
import {
  createDatabaseUserAction,
  type DbUserActionState,
} from "@/app/settings/users/actions";

/**
 * DBユーザーの作成フォーム。パスワードはURLに載せずに1度だけ表示したいため、
 * リダイレクトではなく useActionState の戻り値で受け取る。
 */
export function DbUserCreateForm({
  namePrefix,
  hosts,
}: {
  namePrefix: string;
  hosts: { value: string; label: string }[];
}) {
  const [state, formAction, isPending] = useActionState<DbUserActionState, FormData>(
    createDatabaseUserAction,
    {},
  );

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction} className="flex flex-col gap-2">
        <input
          name="name"
          defaultValue={namePrefix}
          required
          placeholder={`${namePrefix}myapp`}
          aria-label="ユーザー名"
          className="rounded-md border px-3 py-2 font-mono text-sm"
        />
        <select
          name="host"
          defaultValue={hosts[0]?.value}
          aria-label="接続元ホスト"
          className="rounded-md border px-3 py-2 text-sm"
        >
          {hosts.map((host) => (
            <option key={host.value} value={host.value}>
              {host.label}
            </option>
          ))}
        </select>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isPending}
            className="hover:bg-accent min-h-11 rounded-md border px-3 text-sm disabled:opacity-50"
          >
            {isPending ? "作成中..." : "ユーザーを作成"}
          </button>
        </div>
      </form>

      {state.error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state.password && (
        <DbUserPasswordNotice account={state.account} password={state.password} />
      )}
    </div>
  );
}
