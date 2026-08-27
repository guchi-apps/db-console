import { describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import {
  assertBaseTableExists,
  assertTableExists,
  fromDatabaseGrantPattern,
  toDatabaseGrantPattern,
  IdentifierNotFoundError,
  InvalidIdentifierError,
  qualifyTable,
  quoteColumn,
  quoteIdentifier,
  ViewNotModifiableError,
} from "@/lib/identifier";

describe("quoteIdentifier / qualifyTable / quoteColumn", () => {
  it("正常な識別子をバッククォートで囲む", () => {
    expect(quoteIdentifier("app_car")).toBe("`app_car`");
  });

  it("db名とテーブル名を完全修飾する", () => {
    expect(qualifyTable("app_car", "vehicles")).toBe("`app_car`.`vehicles`");
  });

  it("カラム名をクォートする", () => {
    expect(quoteColumn("created_at")).toBe("`created_at`");
  });

  it.each([
    "app_car; DROP TABLE users",
    "app`car",
    "app car",
    "app.car",
    "app-car",
    "",
    "app/*comment*/car",
  ])("不正な識別子 %s を拒否する", (value) => {
    expect(() => qualifyTable(value, "vehicles")).toThrow(InvalidIdentifierError);
    expect(() => qualifyTable("app_car", value)).toThrow(InvalidIdentifierError);
  });
});

/**
 * assertTableExists / assertBaseTableExists は information_schema への SELECT のみで
 * 判定するため、Pool を最小限のスタブに差し替えて検証する（実DBは不要）。
 */
function stubPool(rows: Record<string, unknown>[]) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return [rows];
    },
  } as unknown as Pool;
  return { pool, queries };
}

describe("assertTableExists / assertBaseTableExists", () => {
  it("テーブルなら両方とも通る", async () => {
    const { pool } = stubPool([{ table_type: "BASE TABLE" }]);
    await expect(assertTableExists(pool, "app_car", "vehicles")).resolves.toBeUndefined();
    await expect(assertBaseTableExists(pool, "app_car", "vehicles")).resolves.toBeUndefined();
  });

  it("ビューは assertTableExists なら通り、assertBaseTableExists は拒否する", async () => {
    const { pool } = stubPool([{ table_type: "VIEW" }]);
    await expect(assertTableExists(pool, "app_car", "vehicle_summary")).resolves.toBeUndefined();
    await expect(assertBaseTableExists(pool, "app_car", "vehicle_summary")).rejects.toThrow(
      ViewNotModifiableError,
    );
  });

  it("存在しない対象は両方とも IdentifierNotFoundError", async () => {
    const { pool } = stubPool([]);
    await expect(assertTableExists(pool, "app_car", "missing")).rejects.toThrow(
      IdentifierNotFoundError,
    );
    await expect(assertBaseTableExists(pool, "app_car", "missing")).rejects.toThrow(
      IdentifierNotFoundError,
    );
  });

  it("不正な識別子はSQLを実行せずに拒否する", async () => {
    const { pool, queries } = stubPool([{ table_type: "BASE TABLE" }]);
    await expect(
      assertBaseTableExists(pool, "app_car", "vehicles; DROP TABLE users"),
    ).rejects.toThrow(InvalidIdentifierError);
    expect(queries).toHaveLength(0);
  });

  it("識別子は必ずプレースホルダーで渡す（SQL本文へ埋め込まない）", async () => {
    const { pool, queries } = stubPool([{ table_type: "BASE TABLE" }]);
    await assertBaseTableExists(pool, "app_car", "vehicles");
    expect(queries[0].params).toEqual(["app_car", "vehicles"]);
    expect(queries[0].sql).not.toContain("app_car");
  });
});

describe("toDatabaseGrantPattern / fromDatabaseGrantPattern", () => {
  it("アンダースコアをエスケープして、そのDBだけに一致するパターンにする", () => {
    expect(toDatabaseGrantPattern("app_car")).toBe("app\\_car");
    expect(toDatabaseGrantPattern("appcar")).toBe("appcar");
  });

  it("不正な文字を含むDB名は拒否する", () => {
    expect(() => toDatabaseGrantPattern("app car")).toThrow(InvalidIdentifierError);
    expect(() => toDatabaseGrantPattern("app%")).toThrow(InvalidIdentifierError);
  });

  it("エスケープしたパターンはDB名へ戻せる", () => {
    for (const name of ["app_car", "app_asset_manager", "appcar"]) {
      expect(fromDatabaseGrantPattern(toDatabaseGrantPattern(name))).toBe(name);
    }
  });

  it("複数DBに掛かるワイルドカード指定はDB名へ戻さない", () => {
    expect(fromDatabaseGrantPattern("app\\_%")).toBeNull();
    expect(fromDatabaseGrantPattern("app_car")).toBeNull();
    expect(fromDatabaseGrantPattern("%")).toBeNull();
  });
});
