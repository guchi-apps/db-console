import { z } from "zod";
import type { DatabaseMode as PrismaDatabaseMode } from "@prisma/client";

import { db } from "@/lib/db";

// アプリ側で操作対象にすることを絶対に許可しないシステムDB。
// 設定画面から追加しようとしても起動時ではなく登録時に拒否する。
export const FORBIDDEN_DATABASE_NAMES = new Set([
  "mysql",
  "information_schema",
  "performance_schema",
  "sys",
]);

export const DATABASE_MODES = ["read-only", "data-write", "schema-write"] as const;
export type DatabaseMode = (typeof DATABASE_MODES)[number];

export interface DatabaseEntry {
  name: string;
  label: string;
  mode: DatabaseMode;
}

const DB_MODE_TO_APP: Record<PrismaDatabaseMode, DatabaseMode> = {
  READ_ONLY: "read-only",
  DATA_WRITE: "data-write",
  SCHEMA_WRITE: "schema-write",
};

const APP_MODE_TO_DB: Record<DatabaseMode, PrismaDatabaseMode> = {
  "read-only": "READ_ONLY",
  "data-write": "DATA_WRITE",
  "schema-write": "SCHEMA_WRITE",
};

export const databaseNameSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_]+$/, "DB名は英数字とアンダースコアのみ使用できます")
  .refine((name) => !FORBIDDEN_DATABASE_NAMES.has(name), {
    message: "システムDBは管理対象に指定できません",
  });

export const databaseLabelSchema = z.string().min(1);
export const databaseModeSchema = z.enum(DATABASE_MODES);

export const databaseEntryInputSchema = z.object({
  name: databaseNameSchema,
  label: databaseLabelSchema,
  mode: databaseModeSchema,
});

export type DatabaseEntryInput = z.infer<typeof databaseEntryInputSchema>;

function toDatabaseEntry(row: { name: string; label: string; mode: PrismaDatabaseMode }): DatabaseEntry {
  return { name: row.name, label: row.label, mode: DB_MODE_TO_APP[row.mode] };
}

/** 管理対象DBの許可リストを取得する（db-console 自身のメタデータDBに保存されている）。 */
export async function getDatabasesConfig(): Promise<DatabaseEntry[]> {
  const rows = await db.managedDatabase.findMany({ orderBy: { name: "asc" } });
  return rows.map(toDatabaseEntry);
}

export async function getDatabaseEntry(name: string): Promise<DatabaseEntry | undefined> {
  const row = await db.managedDatabase.findUnique({ where: { name } });
  return row ? toDatabaseEntry(row) : undefined;
}

export async function isDatabaseAllowed(name: string): Promise<boolean> {
  return (await getDatabaseEntry(name)) !== undefined;
}

export class DuplicateDatabaseError extends Error {
  constructor(name: string) {
    super(`既に登録されているDB名です: ${name}`);
    this.name = "DuplicateDatabaseError";
  }
}

export async function createDatabaseEntry(input: DatabaseEntryInput): Promise<DatabaseEntry> {
  const parsed = databaseEntryInputSchema.parse(input);
  const existing = await db.managedDatabase.findUnique({ where: { name: parsed.name } });
  if (existing) {
    throw new DuplicateDatabaseError(parsed.name);
  }
  const row = await db.managedDatabase.create({
    data: { name: parsed.name, label: parsed.label, mode: APP_MODE_TO_DB[parsed.mode] },
  });
  return toDatabaseEntry(row);
}

export async function updateDatabaseEntry(
  name: string,
  input: { label: string; mode: DatabaseMode },
): Promise<DatabaseEntry> {
  const label = databaseLabelSchema.parse(input.label);
  const mode = databaseModeSchema.parse(input.mode);
  const row = await db.managedDatabase.update({
    where: { name },
    data: { label, mode: APP_MODE_TO_DB[mode] },
  });
  return toDatabaseEntry(row);
}

export async function deleteDatabaseEntry(name: string): Promise<void> {
  await db.managedDatabase.delete({ where: { name } });
}

/** 破壊的操作の可否など、モードの強さを比較するためのランク。 */
const MODE_RANK: Record<DatabaseMode, number> = {
  "read-only": 0,
  "data-write": 1,
  "schema-write": 2,
};

export function modeAtLeast(mode: DatabaseMode, required: DatabaseMode): boolean {
  return MODE_RANK[mode] >= MODE_RANK[required];
}
