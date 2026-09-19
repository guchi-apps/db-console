"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUserId } from "@/lib/session";
import {
  getTableColumns,
  getRowByPrimaryKey,
  insertRow,
  updateRow,
  deleteRows,
} from "@/lib/introspection";
import { buildRowDataFromForm } from "@/lib/row-form";
import { writeAuditLogSafely } from "@/lib/audit";

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

  // try で囲むのは操作の実行だけ。監査ログは結果が確定したあとに書き、失敗しても成否を変えない（#135）。
  let data: Record<string, unknown>;
  let affectedRows: number;
  try {
    const columns = await getTableColumns(db, table);
    data = buildRowDataFromForm(formData, columns);
    ({ affectedRows } = await insertRow(db, table, data));
  } catch (error) {
    const message = error instanceof Error ? error.message : "追加に失敗しました";
    await writeAuditLogSafely({
      userId,
      action: "ROW_INSERT",
      databaseName: db,
      tableName: table,
      status: "FAILURE",
      errorMessage: message,
    });
    redirect(`${listPath}/new?error=${encodeURIComponent(message)}`);
  }
  await writeAuditLogSafely({
    userId,
    action: "ROW_INSERT",
    databaseName: db,
    tableName: table,
    afterData: data,
    affectedRows,
    status: "SUCCESS",
  });

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

  let data: Record<string, unknown>;
  let affectedRows: number | undefined;
  try {
    const columns = await getTableColumns(db, table);
    // 触っていないカラムまで書き戻さないよう、現在の行と比べて差分のあるものだけを更新する。
    const currentRow = await getRowByPrimaryKey(db, table, pkValues);
    if (!currentRow) {
      throw new Error("対象のレコードが見つかりません");
    }
    data = buildRowDataFromForm(formData, columns, currentRow);
    if (Object.keys(data).length > 0) {
      ({ affectedRows } = await updateRow(db, table, pkValues, data));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新に失敗しました";
    await writeAuditLogSafely({
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
  // 変更が無ければ更新も監査ログも残さない。
  if (Object.keys(data).length > 0) {
    await writeAuditLogSafely({
      userId,
      action: "ROW_UPDATE",
      databaseName: db,
      tableName: table,
      objectName: JSON.stringify(pkValues),
      afterData: data,
      affectedRows,
      status: "SUCCESS",
    });
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

  let affectedRows: number;
  try {
    ({ affectedRows } = await deleteRows(db, table, pkValuesList));
  } catch (error) {
    const message = error instanceof Error ? error.message : "削除に失敗しました";
    await writeAuditLogSafely({
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
  await writeAuditLogSafely({
    userId,
    action: "ROW_DELETE",
    databaseName: db,
    tableName: table,
    objectName: JSON.stringify(pkValuesList),
    affectedRows,
    status: "SUCCESS",
  });

  revalidatePath(listPath);
  redirect(listPath);
}
