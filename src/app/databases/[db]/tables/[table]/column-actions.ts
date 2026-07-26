"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUserId } from "@/lib/session";
import {
  addColumn,
  addIndex,
  addPrimaryKey,
  dropColumn,
  dropIndex,
  getTableColumns,
  modifyColumn,
  type ColumnModificationInput,
} from "@/lib/introspection";
import { buildSqlType, KEEP_CURRENT_TYPE_KEY } from "@/lib/column-types";
import { isReauthValid } from "@/lib/reauth";
import { writeAuditLog } from "@/lib/audit";

function structurePath(db: string, table: string): string {
  return `/databases/${db}/tables/${table}/structure`;
}

export async function addColumnAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const db = String(formData.get("__db") ?? "");
  const table = String(formData.get("__table") ?? "");
  const path = structurePath(db, table);

  const columnName = String(formData.get("columnName") ?? "").trim();
  const typeKey = String(formData.get("typeKey") ?? "");
  const param1 = String(formData.get("param1") ?? "");
  const param2 = String(formData.get("param2") ?? "");
  const nullable = formData.get("nullable") === "on";
  const defaultValue = String(formData.get("defaultValue") ?? "").trim();

  try {
    const sqlType = buildSqlType(typeKey, param1, param2);
    await addColumn(db, table, { columnName, sqlType, nullable, defaultValue: defaultValue || undefined });
    await writeAuditLog({
      userId,
      action: "COLUMN_ADD",
      databaseName: db,
      tableName: table,
      objectName: columnName,
      status: "SUCCESS",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "カラム追加に失敗しました";
    await writeAuditLog({
      userId,
      action: "COLUMN_ADD",
      databaseName: db,
      tableName: table,
      objectName: columnName,
      status: "FAILURE",
      errorMessage: message,
    });
    redirect(`${path}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(path);
  redirect(path);
}

export async function modifyColumnAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const db = String(formData.get("__db") ?? "");
  const table = String(formData.get("__table") ?? "");
  const path = structurePath(db, table);

  const columnName = String(formData.get("columnName") ?? "");
  const typeKey = String(formData.get("typeKey") ?? "");
  const param1 = String(formData.get("param1") ?? "");
  const param2 = String(formData.get("param2") ?? "");
  const nullable = formData.get("nullable") === "on";
  const defaultValue = String(formData.get("defaultValue") ?? "").trim();
  const comment = String(formData.get("comment") ?? "").trim();
  const positionKind = String(formData.get("positionKind") ?? "keep");
  const positionAfter = String(formData.get("positionAfter") ?? "");

  try {
    let sqlType: string;
    if (typeKey === KEEP_CURRENT_TYPE_KEY) {
      // クライアントから送られた型文字列は信用せず、サーバー側で現在値を再取得する。
      const columns = await getTableColumns(db, table);
      const current = columns.find((c) => c.name === columnName);
      if (!current) {
        throw new Error(`カラムが見つかりません: ${columnName}`);
      }
      sqlType = current.columnType;
    } else {
      sqlType = buildSqlType(typeKey, param1, param2);
    }

    const position: ColumnModificationInput["position"] =
      positionKind === "first" ? "first" : positionKind === "after" ? { after: positionAfter } : undefined;

    await modifyColumn(db, table, columnName, {
      sqlType,
      nullable,
      defaultValue: defaultValue || undefined,
      comment: comment || undefined,
      position,
    });
    await writeAuditLog({
      userId,
      action: "COLUMN_ALTER",
      databaseName: db,
      tableName: table,
      objectName: columnName,
      status: "SUCCESS",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "カラム編集に失敗しました";
    await writeAuditLog({
      userId,
      action: "COLUMN_ALTER",
      databaseName: db,
      tableName: table,
      objectName: columnName,
      status: "FAILURE",
      errorMessage: message,
    });
    redirect(`${path}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(path);
  redirect(path);
}

export async function dropColumnAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const db = String(formData.get("__db") ?? "");
  const table = String(formData.get("__table") ?? "");
  const columnName = String(formData.get("columnName") ?? "");
  const confirmName = String(formData.get("confirmName") ?? "");
  const path = structurePath(db, table);

  if (confirmName !== columnName) {
    redirect(`${path}?error=${encodeURIComponent("カラム名の入力が一致しません")}`);
  }
  if (!(await isReauthValid())) {
    redirect(`/reauth?returnTo=${encodeURIComponent(path)}`);
  }

  try {
    await dropColumn(db, table, columnName);
    await writeAuditLog({
      userId,
      action: "COLUMN_DROP",
      databaseName: db,
      tableName: table,
      objectName: columnName,
      status: "SUCCESS",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "カラム削除に失敗しました";
    await writeAuditLog({
      userId,
      action: "COLUMN_DROP",
      databaseName: db,
      tableName: table,
      objectName: columnName,
      status: "FAILURE",
      errorMessage: message,
    });
    redirect(`${path}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(path);
  redirect(path);
}

export async function addIndexAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const db = String(formData.get("__db") ?? "");
  const table = String(formData.get("__table") ?? "");
  const path = structurePath(db, table);

  const kind = String(formData.get("kind") ?? "index");
  const indexName = String(formData.get("indexName") ?? "").trim();
  const columns = String(formData.get("columns") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  try {
    if (kind === "primary") {
      await addPrimaryKey(db, table, columns);
    } else {
      await addIndex(db, table, { indexName, columns, unique: kind === "unique" });
    }
    await writeAuditLog({
      userId,
      action: "INDEX_ADD",
      databaseName: db,
      tableName: table,
      objectName: kind === "primary" ? "PRIMARY" : indexName,
      status: "SUCCESS",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "インデックス追加に失敗しました";
    await writeAuditLog({
      userId,
      action: "INDEX_ADD",
      databaseName: db,
      tableName: table,
      status: "FAILURE",
      errorMessage: message,
    });
    redirect(`${path}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(path);
  redirect(path);
}

export async function dropIndexAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const db = String(formData.get("__db") ?? "");
  const table = String(formData.get("__table") ?? "");
  const indexName = String(formData.get("indexName") ?? "");
  const confirmName = String(formData.get("confirmName") ?? "");
  const path = structurePath(db, table);

  if (confirmName !== indexName) {
    redirect(`${path}?error=${encodeURIComponent("インデックス名の入力が一致しません")}`);
  }
  if (!(await isReauthValid())) {
    redirect(`/reauth?returnTo=${encodeURIComponent(path)}`);
  }

  try {
    await dropIndex(db, table, indexName);
    await writeAuditLog({
      userId,
      action: "INDEX_DROP",
      databaseName: db,
      tableName: table,
      objectName: indexName,
      status: "SUCCESS",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "インデックス削除に失敗しました";
    await writeAuditLog({
      userId,
      action: "INDEX_DROP",
      databaseName: db,
      tableName: table,
      objectName: indexName,
      status: "FAILURE",
      errorMessage: message,
    });
    redirect(`${path}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(path);
  redirect(path);
}
