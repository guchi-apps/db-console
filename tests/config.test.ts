import { describe, expect, it } from "vitest";
import { getDatabasesConfig, modeAtLeast, parseDatabasesConfig } from "@/lib/config";

describe("parseDatabasesConfig", () => {
  it("正しい設定をパースできる", () => {
    const entries = parseDatabasesConfig({
      databases: [{ name: "app_car", label: "車両管理", mode: "data-write" }],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("app_car");
  });

  it("システムDBを拒否する", () => {
    expect(() =>
      parseDatabasesConfig({
        databases: [{ name: "mysql", label: "システム", mode: "read-only" }],
      }),
    ).toThrow();
  });

  it.each(["information_schema", "performance_schema", "sys"])(
    "システムDB %s を拒否する",
    (name) => {
      expect(() =>
        parseDatabasesConfig({
          databases: [{ name, label: "システム", mode: "read-only" }],
        }),
      ).toThrow();
    },
  );

  it("不正な文字を含むDB名を拒否する", () => {
    expect(() =>
      parseDatabasesConfig({
        databases: [{ name: "app-car; DROP TABLE", label: "不正", mode: "read-only" }],
      }),
    ).toThrow();
  });

  it("不正なmodeを拒否する", () => {
    expect(() =>
      parseDatabasesConfig({
        databases: [{ name: "app_car", label: "車両管理", mode: "admin" }],
      }),
    ).toThrow();
  });

  it("重複したDB名を拒否する", () => {
    expect(() =>
      parseDatabasesConfig({
        databases: [
          { name: "app_car", label: "車両管理", mode: "data-write" },
          { name: "app_car", label: "重複", mode: "read-only" },
        ],
      }),
    ).toThrow();
  });

  it("databasesが空配列だと拒否する", () => {
    expect(() => parseDatabasesConfig({ databases: [] })).toThrow();
  });
});

describe("modeAtLeast", () => {
  it("read-onlyはdata-writeを満たさない", () => {
    expect(modeAtLeast("read-only", "data-write")).toBe(false);
  });

  it("schema-writeは全モードを満たす", () => {
    expect(modeAtLeast("schema-write", "read-only")).toBe(true);
    expect(modeAtLeast("schema-write", "data-write")).toBe(true);
    expect(modeAtLeast("schema-write", "schema-write")).toBe(true);
  });
});

describe("getDatabasesConfig（実ファイル config/databases.yml を読む）", () => {
  it("プロジェクト同梱の設定ファイルをロードできる", () => {
    const entries = getDatabasesConfig();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((entry) => entry.name === "app_car")).toBe(true);
  });
});
