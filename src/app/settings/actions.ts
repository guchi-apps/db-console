"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUserId } from "@/lib/session";
import {
  createDatabaseEntry,
  deleteDatabaseEntry,
  updateDatabaseEntry,
  type DatabaseMode,
} from "@/lib/config";
import { writeAuditLog } from "@/lib/audit";

function redirectWithError(message: string): never {
  redirect(`/settings?error=${encodeURIComponent(message)}`);
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
