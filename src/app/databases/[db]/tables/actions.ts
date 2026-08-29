"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUserId } from "@/lib/session";
import { createTable, type CreateTableColumnInput } from "@/lib/introspection";
import { buildSqlType } from "@/lib/column-types";
import { assertSchemaChangeReauth } from "@/lib/reauth";
import { writeAuditLog } from "@/lib/audit";

const MAX_COLUMN_ROWS = 8;

export async function createTableAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const db = String(formData.get("__db") ?? "");
  const tableName = String(formData.get("tableName") ?? "").trim();
  const listPath = `/databases/${db}/tables`;
  const newPath = `${listPath}/new`;

  // テーブルの作成は構造変更なので、実行前に本人確認を求める（#105）。
  await assertSchemaChangeReauth(newPath);

  try {
    const columns: CreateTableColumnInput[] = [];
    for (let i = 0; i < MAX_COLUMN_ROWS; i++) {
      const columnName = String(formData.get(`columnName_${i}`) ?? "").trim();
      if (!columnName) continue;

      const typeKey = String(formData.get(`typeKey_${i}`) ?? "");
      const param1 = String(formData.get(`param1_${i}`) ?? "");
      const param2 = String(formData.get(`param2_${i}`) ?? "");
      const nullable = formData.get(`nullable_${i}`) === "on";
      const primaryKey = formData.get(`primaryKey_${i}`) === "on";

      columns.push({
        columnName,
        sqlType: buildSqlType(typeKey, param1, param2),
        nullable,
        primaryKey,
      });
    }

    await createTable(db, tableName, columns);
    await writeAuditLog({
      userId,
      action: "TABLE_CREATE",
      databaseName: db,
      tableName,
      status: "SUCCESS",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "テーブル作成に失敗しました";
    await writeAuditLog({
      userId,
      action: "TABLE_CREATE",
      databaseName: db,
      tableName,
      status: "FAILURE",
      errorMessage: message,
    });
    redirect(`${newPath}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(listPath);
  redirect(`${listPath}/${tableName}`);
}
