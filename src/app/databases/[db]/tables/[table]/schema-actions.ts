"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUserId } from "@/lib/session";
import { dropTable, renameTable, truncateTable } from "@/lib/introspection";
import { isReauthValid } from "@/lib/reauth";
import { writeAuditLog } from "@/lib/audit";

export async function renameTableAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const db = String(formData.get("__db") ?? "");
  const table = String(formData.get("__table") ?? "");
  const newName = String(formData.get("newName") ?? "").trim();
  const structurePath = `/databases/${db}/tables/${table}/structure`;

  try {
    await renameTable(db, table, newName);
    await writeAuditLog({
      userId,
      action: "TABLE_ALTER",
      databaseName: db,
      tableName: table,
      objectName: newName,
      status: "SUCCESS",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "名前変更に失敗しました";
    await writeAuditLog({
      userId,
      action: "TABLE_ALTER",
      databaseName: db,
      tableName: table,
      status: "FAILURE",
      errorMessage: message,
    });
    redirect(`${structurePath}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/databases/${db}/tables`);
  redirect(`/databases/${db}/tables/${newName}/structure`);
}

export async function truncateTableAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const db = String(formData.get("__db") ?? "");
  const table = String(formData.get("__table") ?? "");
  const confirmName = String(formData.get("confirmName") ?? "");
  const dangerPath = `/databases/${db}/tables/${table}/danger`;

  if (confirmName !== table) {
    redirect(`${dangerPath}?error=${encodeURIComponent("テーブル名の入力が一致しません")}`);
  }
  if (!(await isReauthValid())) {
    redirect(`/reauth?returnTo=${encodeURIComponent(dangerPath)}`);
  }

  try {
    await truncateTable(db, table);
    await writeAuditLog({
      userId,
      action: "TABLE_TRUNCATE",
      databaseName: db,
      tableName: table,
      status: "SUCCESS",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "空データ化に失敗しました";
    await writeAuditLog({
      userId,
      action: "TABLE_TRUNCATE",
      databaseName: db,
      tableName: table,
      status: "FAILURE",
      errorMessage: message,
    });
    redirect(`${dangerPath}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/databases/${db}/tables/${table}`);
  redirect(`/databases/${db}/tables/${table}`);
}

export async function dropTableAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const db = String(formData.get("__db") ?? "");
  const table = String(formData.get("__table") ?? "");
  const confirmName = String(formData.get("confirmName") ?? "");
  const dangerPath = `/databases/${db}/tables/${table}/danger`;

  if (confirmName !== table) {
    redirect(`${dangerPath}?error=${encodeURIComponent("テーブル名の入力が一致しません")}`);
  }
  if (!(await isReauthValid())) {
    redirect(`/reauth?returnTo=${encodeURIComponent(dangerPath)}`);
  }

  try {
    await dropTable(db, table);
    await writeAuditLog({
      userId,
      action: "TABLE_DROP",
      databaseName: db,
      tableName: table,
      status: "SUCCESS",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "削除に失敗しました";
    await writeAuditLog({
      userId,
      action: "TABLE_DROP",
      databaseName: db,
      tableName: table,
      status: "FAILURE",
      errorMessage: message,
    });
    redirect(`${dangerPath}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/databases/${db}/tables`);
  redirect(`/databases/${db}/tables`);
}
