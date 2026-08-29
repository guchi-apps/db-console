import { z } from "zod";

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

// 管理対象DBごとの操作モード（閲覧のみ / データ編集可 / 構造変更可）は #105 で廃止した。
// 許可リストに載っているDBはすべて構造変更まで行える。危険なのは設定ではなく操作の側だと
// 捉え直し、構造変更（DDL）を実行する瞬間に確認ダイアログと再認証を挟む方式へ変えている
// （src/lib/reauth.ts の assertSchemaChangeReauth を参照）。モードを復活させる変更は
// この決定を覆すことになるので、Issueで相談すること。
export interface DatabaseEntry {
  name: string;
}

export const databaseNameSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_]+$/, "DB名は英数字とアンダースコアのみ使用できます")
  .refine((name) => !FORBIDDEN_DATABASE_NAMES.has(name), {
    message: "システムDBは管理対象に指定できません",
  });

export const databaseEntryInputSchema = z.object({
  name: databaseNameSchema,
});

export type DatabaseEntryInput = z.infer<typeof databaseEntryInputSchema>;

function toDatabaseEntry(row: { name: string }): DatabaseEntry {
  return { name: row.name };
}

/**
 * 管理対象DBの許可リストを取得する（db-console 自身のメタデータDBに保存されている）。
 * 除外中（excludedAt が入っている）の行は許可リストに含めない。
 */
export async function getDatabasesConfig(): Promise<DatabaseEntry[]> {
  const rows = await db.managedDatabase.findMany({
    where: { excludedAt: null },
    orderBy: { name: "asc" },
  });
  return rows.map(toDatabaseEntry);
}

/**
 * 自動登録の判定用に、除外中のものも含めた登録済みDB名をすべて返す（#97）。
 * 除外したDBを次の描画で登録し直さないために使う。
 */
export async function listAllManagedDatabaseNames(): Promise<string[]> {
  const rows = await db.managedDatabase.findMany({ select: { name: true } });
  return rows.map((row) => row.name);
}

export async function getDatabaseEntry(name: string): Promise<DatabaseEntry | undefined> {
  const row = await db.managedDatabase.findUnique({ where: { name } });
  return row && row.excludedAt === null ? toDatabaseEntry(row) : undefined;
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
  if (existing && existing.excludedAt === null) {
    throw new DuplicateDatabaseError(parsed.name);
  }
  // 一度除外したDBを登録し直すときは、行を作り直さず除外を解除する。
  if (existing) {
    const revived = await db.managedDatabase.update({
      where: { name: parsed.name },
      data: { excludedAt: null },
    });
    return toDatabaseEntry(revived);
  }
  const row = await db.managedDatabase.create({ data: { name: parsed.name } });
  return toDatabaseEntry(row);
}

/**
 * 管理対象から外す。`app_` で始まるDBは行を消しても自動登録（managed-db-sync.ts）で
 * 戻ってきてしまうため、行は残して「除外中」にする（#97）。
 * 除外したDBは設定画面の「既存DBを登録」から登録し直せる。
 */
export async function deleteDatabaseEntry(name: string): Promise<void> {
  if (isManagedName(name)) {
    await db.managedDatabase.update({ where: { name }, data: { excludedAt: new Date() } });
    return;
  }
  await db.managedDatabase.delete({ where: { name } });
}
