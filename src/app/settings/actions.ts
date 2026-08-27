"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUserId } from "@/lib/session";
import {
  createDatabaseEntry,
  deleteDatabaseEntry,
  updateDatabaseEntry,
  databaseNameSchema,
  assertManagedName,
  type DatabaseMode,
} from "@/lib/config";
import { createDatabase } from "@/lib/admin-db";
import { isReauthValid } from "@/lib/reauth";
import { writeAuditLog } from "@/lib/audit";

function redirectWithError(message: string): never {
  redirect(`/settings?error=${encodeURIComponent(message)}`);
}

/**
 * MariaDB上にDBを新規作成し、そのまま管理対象として登録する（#91）。
 * 作成できるのは app_ で始まる名前だけ。作成後は閲覧・編集用ロールへの
 * GRANT まで済ませるため、追加のインフラ作業なしで一覧へ出る。
 */
export async function createDatabaseAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const name = String(formData.get("name") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const mode = String(formData.get("mode") ?? "") as DatabaseMode;

  try {
    const parsedName = databaseNameSchema.safeParse(name);
    if (!parsedName.success) {
      throw new Error(parsedName.error.issues[0]?.message ?? "DB名が不正です");
    }
    assertManagedName("DB名", name);
    if (label.length === 0) {
      throw new Error("表示名を入力してください");
    }
    const { grantedAccounts } = await createDatabase(name, mode);
    const entry = await createDatabaseEntry({ name, label, mode });
    await writeAuditLog({
      userId,
      action: "DATABASE_CREATE",
      databaseName: name,
      afterData: { ...entry, grantedAccounts },
      status: "SUCCESS",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DBの作成に失敗しました";
    await writeAuditLog({
      userId,
      action: "DATABASE_CREATE",
      databaseName: name,
      status: "FAILURE",
      errorMessage: message,
    });
    redirectWithError(message);
  }

  revalidatePath("/settings");
  revalidatePath("/");
  redirect("/settings");
}

export async function createManagedDatabaseAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const name = String(formData.get("name") ?? "");
  const label = String(formData.get("label") ?? "");
  const mode = String(formData.get("mode") ?? "") as DatabaseMode;

  try {
    const entry = await createDatabaseEntry({ name, label, mode });
    await writeAuditLog({
      userId,
      action: "MANAGED_DB_CREATE",
      databaseName: entry.name,
      afterData: entry,
      status: "SUCCESS",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "登録に失敗しました";
    await writeAuditLog({
      userId,
      action: "MANAGED_DB_CREATE",
      databaseName: name,
      status: "FAILURE",
      errorMessage: message,
    });
    redirectWithError(message);
  }

  revalidatePath("/settings");
  revalidatePath("/");
  redirect("/settings");
}

export async function updateManagedDatabaseAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const name = String(formData.get("name") ?? "");
  const label = String(formData.get("label") ?? "");
  const mode = String(formData.get("mode") ?? "") as DatabaseMode;

  try {
    const entry = await updateDatabaseEntry(name, { label, mode });
    await writeAuditLog({
      userId,
      action: "MANAGED_DB_UPDATE",
      databaseName: entry.name,
      afterData: entry,
      status: "SUCCESS",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新に失敗しました";
    await writeAuditLog({
      userId,
      action: "MANAGED_DB_UPDATE",
      databaseName: name,
      status: "FAILURE",
      errorMessage: message,
    });
    redirectWithError(message);
  }

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
    await writeAuditLog({
      userId,
      action: "MANAGED_DB_DELETE",
      databaseName: name,
      status: "SUCCESS",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "削除に失敗しました";
    await writeAuditLog({
      userId,
      action: "MANAGED_DB_DELETE",
      databaseName: name,
      status: "FAILURE",
      errorMessage: message,
    });
    redirectWithError(message);
  }

  revalidatePath("/settings");
  revalidatePath("/");
  redirect("/settings");
}
