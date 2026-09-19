"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUserId } from "@/lib/session";
import { dropTable, renameTable, truncateTable } from "@/lib/introspection";
import { assertSchemaChangeReauth } from "@/lib/reauth";
import { writeAuditLogSafely } from "@/lib/audit";

export async function renameTableAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const db = String(formData.get("__db") ?? "");
  const table = String(formData.get("__table") ?? "");
  const newName = String(formData.get("newName") ?? "").trim();
  const structurePath = `/databases/${db}/tables/${table}/structure`;

  // 名前変更も構造変更なので、実行前に本人確認を求める（#105）。
  await assertSchemaChangeReauth(structurePath);

  try {
    await renameTable(db, table, newName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "名前変更に失敗しました";
    await writeAuditLogSafely({
      userId,
      action: "TABLE_ALTER",
      databaseName: db,
      tableName: table,
      status: "FAILURE",
      errorMessage: message,
    });
    redirect(`${structurePath}?error=${encodeURIComponent(message)}`);
  }

  await writeAuditLogSafely({
    userId,
    action: "TABLE_ALTER",
    databaseName: db,
    tableName: table,
    objectName: newName,
    status: "SUCCESS",
  });

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
  await assertSchemaChangeReauth(dangerPath);

  try {
    await truncateTable(db, table);
  } catch (error) {
    const message = error instanceof Error ? error.message : "空データ化に失敗しました";
    await writeAuditLogSafely({
      userId,
      action: "TABLE_TRUNCATE",
      databaseName: db,
      tableName: table,
      status: "FAILURE",
      errorMessage: message,
    });
    redirect(`${dangerPath}?error=${encodeURIComponent(message)}`);
  }

  await writeAuditLogSafely({
    userId,
    action: "TABLE_TRUNCATE",
    databaseName: db,
    tableName: table,
    status: "SUCCESS",
  });

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
  await assertSchemaChangeReauth(dangerPath);

  try {
    await dropTable(db, table);
  } catch (error) {
    const message = error instanceof Error ? error.message : "削除に失敗しました";
    await writeAuditLogSafely({
      userId,
      action: "TABLE_DROP",
      databaseName: db,
      tableName: table,
      status: "FAILURE",
      errorMessage: message,
    });
    redirect(`${dangerPath}?error=${encodeURIComponent(message)}`);
  }

  await writeAuditLogSafely({
    userId,
    action: "TABLE_DROP",
    databaseName: db,
    tableName: table,
    status: "SUCCESS",
  });

  revalidatePath(`/databases/${db}/tables`);
  redirect(`/databases/${db}/tables`);
}
