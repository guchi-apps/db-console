import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

// アプリ側で操作対象にすることを絶対に許可しないシステムDB。
// config/databases.yml に誤って記載されても起動時に拒否する。
const FORBIDDEN_DATABASE_NAMES = new Set([
  "mysql",
  "information_schema",
  "performance_schema",
  "sys",
]);

const databaseModeSchema = z.enum(["read-only", "data-write", "schema-write"]);

const databaseEntrySchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9_]+$/, "DB名は英数字とアンダースコアのみ使用できます"),
    label: z.string().min(1),
    mode: databaseModeSchema,
  })
  .refine((entry) => !FORBIDDEN_DATABASE_NAMES.has(entry.name), {
    message: "システムDBは管理対象に指定できません",
    path: ["name"],
  });

const databasesConfigSchema = z.object({
  databases: z.array(databaseEntrySchema).min(1),
});

export type DatabaseMode = z.infer<typeof databaseModeSchema>;
export type DatabaseEntry = z.infer<typeof databaseEntrySchema>;

let cachedConfig: DatabaseEntry[] | null = null;

/** パース済みのYAML内容を検証する純粋関数（ファイルI/Oを含まないためテストしやすい）。 */
export function parseDatabasesConfig(parsed: unknown): DatabaseEntry[] {
  const result = databasesConfigSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `config/databases.yml の設定が不正です: ${result.error.message}`,
    );
  }

  const seenNames = new Set<string>();
  for (const entry of result.data.databases) {
    if (seenNames.has(entry.name)) {
      throw new Error(
        `config/databases.yml に重複したDB名があります: ${entry.name}`,
      );
    }
    seenNames.add(entry.name);
  }

  return result.data.databases;
}

function loadDatabasesConfig(): DatabaseEntry[] {
  const configPath = path.join(process.cwd(), "config", "databases.yml");
  const raw = fs.readFileSync(configPath, "utf-8");
  return parseDatabasesConfig(parse(raw));
}

/** config/databases.yml をロード・検証する。初回呼び出し時のみファイルを読み、以降はキャッシュを返す。 */
export function getDatabasesConfig(): DatabaseEntry[] {
  if (!cachedConfig) {
    cachedConfig = loadDatabasesConfig();
  }
  return cachedConfig;
}

export function getDatabaseEntry(name: string): DatabaseEntry | undefined {
  return getDatabasesConfig().find((entry) => entry.name === name);
}

export function isDatabaseAllowed(name: string): boolean {
  return getDatabaseEntry(name) !== undefined;
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
