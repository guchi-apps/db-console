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
  modifyColumn,
  type ColumnModificationInput,
} from "@/lib/introspection";
import { buildSqlType, KEEP_CURRENT_TYPE_KEY } from "@/lib/column-types";
import { isColumnDefaultMode } from "@/lib/column-default";
import type { ColumnDefaultInput } from "@/lib/column-definition";
import { assertSchemaChangeReauth } from "@/lib/reauth";
import { writeAuditLogSafely } from "@/lib/audit";

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

  // カラムの追加は構造変更なので、実行前に本人確認を求める（#105）。
  await assertSchemaChangeReauth(path);

  try {
    const sqlType = buildSqlType(typeKey, param1, param2);
    await addColumn(db, table, { columnName, sqlType, nullable, defaultValue: defaultValue || undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : "カラム追加に失敗しました";
    await writeAuditLogSafely({
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

  await writeAuditLogSafely({
    userId,
    action: "COLUMN_ADD",
    databaseName: db,
    tableName: table,
    objectName: columnName,
    status: "SUCCESS",
  });

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
  const defaultMode = String(formData.get("defaultMode") ?? "keep");
  // 「値を指定」は空文字（DEFAULT ''）も意味を持つため、trim しない。
  const defaultValue = String(formData.get("defaultValue") ?? "");
  const comment = String(formData.get("comment") ?? "").trim();
  const positionKind = String(formData.get("positionKind") ?? "keep");
  const positionAfter = String(formData.get("positionAfter") ?? "");

  // カラムの変更は構造変更なので、実行前に本人確認を求める（#105）。
  await assertSchemaChangeReauth(path);

  try {
    // 「現在の型のまま」は null で渡し、modifyColumn がDBから読み直した現在値を使う
    // （クライアントから送られた型文字列は信用しない）。
    const sqlType = typeKey === KEEP_CURRENT_TYPE_KEY ? null : buildSqlType(typeKey, param1, param2);

    // デフォルト値は column_default をフォームへ戻して送り返さず、指定方法を明示的に選ばせる（#132）。
    if (!isColumnDefaultMode(defaultMode)) {
      throw new Error("デフォルト値の指定方法が不正です");
    }
    const defaultInput: ColumnDefaultInput =
      defaultMode === "value" ? { mode: "value", value: defaultValue } : { mode: defaultMode };

    const position: ColumnModificationInput["position"] =
      positionKind === "first" ? "first" : positionKind === "after" ? { after: positionAfter } : undefined;

    await modifyColumn(db, table, columnName, {
      sqlType,
      nullable,
      default: defaultInput,
      comment: comment || undefined,
      position,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "カラム編集に失敗しました";
    await writeAuditLogSafely({
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

  await writeAuditLogSafely({
    userId,
    action: "COLUMN_ALTER",
    databaseName: db,
    tableName: table,
    objectName: columnName,
    status: "SUCCESS",
  });

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
  await assertSchemaChangeReauth(path);

  try {
    await dropColumn(db, table, columnName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "カラム削除に失敗しました";
    await writeAuditLogSafely({
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

  await writeAuditLogSafely({
    userId,
    action: "COLUMN_DROP",
    databaseName: db,
    tableName: table,
    objectName: columnName,
    status: "SUCCESS",
  });

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

  // インデックスの追加は構造変更なので、実行前に本人確認を求める（#105）。
  await assertSchemaChangeReauth(path);

  try {
    if (kind === "primary") {
      await addPrimaryKey(db, table, columns);
    } else {
      await addIndex(db, table, { indexName, columns, unique: kind === "unique" });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "インデックス追加に失敗しました";
    await writeAuditLogSafely({
      userId,
      action: "INDEX_ADD",
      databaseName: db,
      tableName: table,
      status: "FAILURE",
      errorMessage: message,
    });
    redirect(`${path}?error=${encodeURIComponent(message)}`);
  }

  await writeAuditLogSafely({
    userId,
    action: "INDEX_ADD",
    databaseName: db,
    tableName: table,
    objectName: kind === "primary" ? "PRIMARY" : indexName,
    status: "SUCCESS",
  });

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
  await assertSchemaChangeReauth(path);

  try {
    await dropIndex(db, table, indexName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "インデックス削除に失敗しました";
    await writeAuditLogSafely({
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

  await writeAuditLogSafely({
    userId,
    action: "INDEX_DROP",
    databaseName: db,
    tableName: table,
    objectName: indexName,
    status: "SUCCESS",
  });

  revalidatePath(path);
  redirect(path);
}
