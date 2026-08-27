"use client";

import { useActionState } from "react";

import { DbUserPasswordNotice } from "@/components/db-user-password-notice";
import {
  resetDatabaseUserPasswordAction,
  type DbUserActionState,
} from "@/app/settings/users/actions";

/** 既存DBユーザーのパスワード再発行。新しいパスワードを1度だけ表示する。 */
export function DbUserPasswordResetForm({ name, host }: { name: string; host: string }) {
  const [state, formAction, isPending] = useActionState<DbUserActionState, FormData>(
    resetDatabaseUserPasswordAction,
    {},
  );

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction}>
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="host" value={host} />
        <button
          type="submit"
          disabled={isPending}
          className="hover:bg-accent min-h-11 rounded-md border px-3 text-sm disabled:opacity-50"
        >
          {isPending ? "再発行中..." : "パスワード再発行"}
        </button>
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
