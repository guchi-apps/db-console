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

// このコンソールが「作成・管理してよい」とみなす名前の接頭辞（#91）。
// VPS上には他アプリの実データを持つDBやシステム用のアカウントが同居しているため、
// 新規作成・権限変更の対象は app_ で始まるDB・ユーザーだけに限定する。
// 既存の管理対象DB（wordpress 等）の登録・閲覧はこの制限の対象外で、
// あくまで「このアプリが新しく作る・権限を書き換える」対象を絞るための制限。
// この接頭辞は #97 から「自動的に管理対象へ取り込む」対象も兼ねる
// （src/lib/managed-db-sync.ts）。app_ 以外は従来どおり設定画面から手で登録する。
export const MANAGED_NAME_PREFIX = "app_";

export class UnmanagedNameError extends Error {
  constructor(kind: string, value: string) {
    super(`${kind}は「${MANAGED_NAME_PREFIX}」で始まる必要があります: ${value}`);
    this.name = "UnmanagedNameError";
  }
}

export function isManagedName(name: string): boolean {
  return name.startsWith(MANAGED_NAME_PREFIX) && name.length > MANAGED_NAME_PREFIX.length;
}

/** 作成・権限変更の対象にしてよい名前かを確認する（違反時は例外）。 */
export function assertManagedName(kind: string, name: string): void {
  if (!isManagedName(name)) {
    throw new UnmanagedNameError(kind, name);
  }
}

export const DATABASE_MODES = ["read-only", "data-write", "schema-write"] as const;
export type DatabaseMode = (typeof DATABASE_MODES)[number];

export interface DatabaseEntry {
  name: string;
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

export const databaseModeSchema = z.enum(DATABASE_MODES);

export const databaseEntryInputSchema = z.object({
  name: databaseNameSchema,
  mode: databaseModeSchema,
});

export type DatabaseEntryInput = z.infer<typeof databaseEntryInputSchema>;

function toDatabaseEntry(row: { name: string; mode: PrismaDatabaseMode }): DatabaseEntry {
  return { name: row.name, mode: DB_MODE_TO_APP[row.mode] };
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
    data: { name: parsed.name, mode: APP_MODE_TO_DB[parsed.mode] },
  });
  return toDatabaseEntry(row);
}

export async function updateDatabaseEntry(
  name: string,
  input: { mode: DatabaseMode },
): Promise<DatabaseEntry> {
  const mode = databaseModeSchema.parse(input.mode);
  const row = await db.managedDatabase.update({
    where: { name },
    data: { mode: APP_MODE_TO_DB[mode] },
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
