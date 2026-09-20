"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUserId } from "@/lib/session";
import {
  createDatabaseEntry,
  deleteDatabaseEntry,
  databaseNameSchema,
  assertManagedName,
} from "@/lib/config";
import { createDatabase } from "@/lib/admin-db";
import { isReauthValid } from "@/lib/reauth";
import { writeAuditLogSafely } from "@/lib/audit";

function redirectWithError(message: string): never {
  redirect(`/settings?error=${encodeURIComponent(message)}`);
}

/**
 * MariaDB上にDBを新規作成し、そのまま管理対象として登録する（#91）。
 * 作成できるのは app_ で始まる名前だけ。作成後はレコード操作用・構造変更用ロールへの
 * GRANT まで済ませるため、追加のインフラ作業なしで一覧へ出る。
 */
export async function createDatabaseAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const name = String(formData.get("name") ?? "").trim();

  let created: Awaited<ReturnType<typeof createDatabaseEntry>>;
  let grantedAccounts: Awaited<ReturnType<typeof createDatabase>>["grantedAccounts"];
  // 監査ログは操作の結果が確定したあとに書く（try に入れると、操作が済んだあとに
  // メタデータDBの書き込みが落ちたとき、実行済みの操作が「失敗」として扱われる。#135・#143）。
  try {
    const parsedName = databaseNameSchema.safeParse(name);
    if (!parsedName.success) {
      throw new Error(parsedName.error.issues[0]?.message ?? "DB名が不正です");
    }
    assertManagedName("DB名", name);
    ({ grantedAccounts } = await createDatabase(name));
    created = await createDatabaseEntry({ name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DBの作成に失敗しました";
    await writeAuditLogSafely({
      userId,
      action: "DATABASE_CREATE",
      databaseName: name,
      status: "FAILURE",
      errorMessage: message,
    });
    redirectWithError(message);
  }

  await writeAuditLogSafely({
    userId,
    action: "DATABASE_CREATE",
    databaseName: name,
    afterData: { ...created, grantedAccounts },
    status: "SUCCESS",
  });

  revalidatePath("/settings");
  revalidatePath("/");
  redirect("/settings");
}

export async function createManagedDatabaseAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const name = String(formData.get("name") ?? "");

  let entry: Awaited<ReturnType<typeof createDatabaseEntry>>;
  try {
    entry = await createDatabaseEntry({ name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "登録に失敗しました";
    await writeAuditLogSafely({
      userId,
      action: "MANAGED_DB_CREATE",
      databaseName: name,
      status: "FAILURE",
      errorMessage: message,
    });
    redirectWithError(message);
  }

  await writeAuditLogSafely({
    userId,
    action: "MANAGED_DB_CREATE",
    databaseName: entry.name,
    afterData: entry,
    status: "SUCCESS",
  });

  revalidatePath("/settings");
  revalidatePath("/");
  redirect("/settings");
}

export async function deleteManagedDatabaseAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const name = String(formData.get("name") ?? "");

  // 管理対象から外すとその画面からDBへ一切アクセスできなくなるため、
  // 他の破壊的操作（TRUNCATE/DROP）と同じく直近5分以内の再認証を求める（#91）。
  if (!(await isReauthValid())) {
    redirect(`/reauth?returnTo=${encodeURIComponent("/settings")}`);
  }

  try {
    await deleteDatabaseEntry(name);
  } catch (error) {
    const message = error instanceof Error ? error.message : "削除に失敗しました";
    await writeAuditLogSafely({
      userId,
      action: "MANAGED_DB_DELETE",
      databaseName: name,
      status: "FAILURE",
      errorMessage: message,
    });
    redirectWithError(message);
  }

  await writeAuditLogSafely({
    userId,
    action: "MANAGED_DB_DELETE",
    databaseName: name,
    status: "SUCCESS",
  });

  revalidatePath("/settings");
  revalidatePath("/");
  redirect("/settings");
}
