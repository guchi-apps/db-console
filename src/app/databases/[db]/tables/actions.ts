"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { createTable, type CreateTableColumnInput } from "@/lib/introspection";
import { buildSqlType } from "@/lib/column-types";
import { writeAuditLog } from "@/lib/audit";

const MAX_COLUMN_ROWS = 8;

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user) {
    throw new Error("認証が必要です");
  }
  return session.user.id;
}

export async function createTableAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const db = String(formData.get("__db") ?? "");
  const tableName = String(formData.get("tableName") ?? "").trim();
  const listPath = `/databases/${db}/tables`;
  const newPath = `${listPath}/new`;

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
