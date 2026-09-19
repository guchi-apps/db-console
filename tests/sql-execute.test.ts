import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const release = vi.fn();

vi.mock("@/lib/config", () => ({
  FORBIDDEN_DATABASE_NAMES: new Set(["mysql", "information_schema", "performance_schema", "sys"]),
}));
vi.mock("@/lib/target-db", () => ({
  getPoolForOperation: vi.fn(async () => ({
    getConnection: async () => ({ query, release }),
  })),
}));

import { executeSql } from "@/lib/sql-execute";

// ロールから見えるDB。app_b は許可リスト外（除外中）だが GRANT は残っている想定。
const SCHEMATA = [
  { schema_name: "information_schema" },
  { schema_name: "app_a" },
  { schema_name: "app_b" },
];

beforeEach(() => {
  query.mockReset();
  release.mockReset();
  query.mockImplementation(async (sql: string) => {
    if (sql.includes("information_schema.schemata")) return [SCHEMATA, []];
    if (sql.startsWith("USE ")) return [{ affectedRows: 0 }, []];
    return [[{ id: 1 }], [{ name: "id" }]];
  });
});

describe("executeSql（#134）", () => {
  it("別のDBを完全修飾名で指すSQLは、USE もSQL本体も発行せずに拒否する", async () => {
    await expect(executeSql("app_a", "SELECT * FROM app_b.users")).rejects.toThrow(/app_b/);

    const issued = query.mock.calls.map(([sql]) => sql as string);
    expect(issued).toHaveLength(1);
    expect(issued[0]).toContain("information_schema.schemata");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("DDLでも別のDBを指していれば拒否する", async () => {
    await expect(executeSql("app_a", "ALTER TABLE app_b.t ADD COLUMN c INT")).rejects.toThrow(
      /app_b/,
    );
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("USE "))).toBe(false);
  });

  it("開いているDBだけを指すSQLは、これまでどおり USE してから実行する", async () => {
    const result = await executeSql("app_a", "SELECT * FROM app_a.users");

    const issued = query.mock.calls.map(([sql]) => sql as string);
    expect(issued[1]).toBe("USE `app_a`");
    expect(issued[2]).toBe("SELECT * FROM app_a.users");
    expect(result.rows).toEqual([{ id: 1 }]);
  });

  it("information_schema の参照は引き続き通す", async () => {
    await expect(
      executeSql("app_a", "SELECT * FROM information_schema.tables"),
    ).resolves.toBeDefined();
  });
});
