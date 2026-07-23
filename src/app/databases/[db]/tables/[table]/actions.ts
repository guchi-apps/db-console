"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { getTableColumns, insertRow, updateRow, deleteRows } from "@/lib/introspection";
import { buildRowDataFromForm } from "@/lib/row-form";
import { writeAuditLog } from "@/lib/audit";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user) {
    throw new Error("認証が必要です");
  }
  return session.user.id;
}

function decodePk(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // ignore
  }
  return {};
}

export async function createRowAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const db = String(formData.get("__db") ?? "");
  const table = String(formData.get("__table") ?? "");
  const listPath = `/databases/${db}/tables/${table}`;

  try {
    const columns = await getTableColumns(db, table);
    const data = buildRowDataFromForm(formData, columns);
    const result = await insertRow(db, table, data);
    await writeAuditLog({
      userId,
      action: "ROW_INSERT",
      databaseName: db,
      tableName: table,
      afterData: data,
      affectedRows: result.affectedRows,
      status: "SUCCESS",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "追加に失敗しました";
    await writeAuditLog({
      userId,
      action: "ROW_INSERT",
      databaseName: db,
      tableName: table,
      status: "FAILURE",
      errorMessage: message,
    });
    redirect(`${listPath}/new?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(listPath);
  redirect(listPath);
}

export async function updateRowAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const db = String(formData.get("__db") ?? "");
  const table = String(formData.get("__table") ?? "");
  const pkRaw = String(formData.get("__pk") ?? "{}");
  const pkValues = decodePk(pkRaw);
  const listPath = `/databases/${db}/tables/${table}`;
  const editPath = `${listPath}/edit?pk=${encodeURIComponent(pkRaw)}`;

  try {
    const columns = await getTableColumns(db, table);
    const data = buildRowDataFromForm(formData, columns);
    const result = await updateRow(db, table, pkValues, data);
    await writeAuditLog({
      userId,
      action: "ROW_UPDATE",
      databaseName: db,
      tableName: table,
      objectName: JSON.stringify(pkValues),
      afterData: data,
      affectedRows: result.affectedRows,
      status: "SUCCESS",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新に失敗しました";
    await writeAuditLog({
      userId,
      action: "ROW_UPDATE",
      databaseName: db,
      tableName: table,
      objectName: JSON.stringify(pkValues),
      status: "FAILURE",
      errorMessage: message,
    });
    redirect(`${editPath}&error=${encodeURIComponent(message)}`);
  }

  revalidatePath(listPath);
  redirect(listPath);
}

export async function deleteRowsAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const db = String(formData.get("__db") ?? "");
  const table = String(formData.get("__table") ?? "");
  const listPath = `/databases/${db}/tables/${table}`;
  const pkRawList = formData.getAll("__pk").map((value) => String(value));
  const pkValuesList = pkRawList.map(decodePk);

  try {
    const result = await deleteRows(db, table, pkValuesList);
    await writeAuditLog({
      userId,
      action: "ROW_DELETE",
      databaseName: db,
      tableName: table,
      objectName: JSON.stringify(pkValuesList),
      affectedRows: result.affectedRows,
      status: "SUCCESS",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "削除に失敗しました";
    await writeAuditLog({
      userId,
      action: "ROW_DELETE",
      databaseName: db,
      tableName: table,
      objectName: JSON.stringify(pkValuesList),
      status: "FAILURE",
      errorMessage: message,
    });
    redirect(`${listPath}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(listPath);
  redirect(listPath);
}
