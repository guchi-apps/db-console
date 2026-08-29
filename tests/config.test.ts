import { describe, expect, it } from "vitest";
import {
  assertManagedName,
  databaseEntryInputSchema,
  databaseNameSchema,
  isManagedName,
  modeAtLeast,
} from "@/lib/config";

describe("databaseNameSchema", () => {
  it("正しいDB名を受け付ける", () => {
    expect(databaseNameSchema.parse("app_car")).toBe("app_car");
  });

  it.each(["mysql", "information_schema", "performance_schema", "sys"])(
    "システムDB %s を拒否する",
    (name) => {
      expect(() => databaseNameSchema.parse(name)).toThrow();
    },
  );

  it.each(["app-car", "app car", "app.car", "app`car", ""])(
    "不正な文字を含むDB名 %s を拒否する",
    (name) => {
      expect(() => databaseNameSchema.parse(name)).toThrow();
    },
  );
});

describe("databaseEntryInputSchema", () => {
  it("正しい入力をパースできる", () => {
    const parsed = databaseEntryInputSchema.parse({ name: "app_car", mode: "data-write" });
    expect(parsed).toEqual({ name: "app_car", mode: "data-write" });
  });

  it("不正なmodeを拒否する", () => {
    expect(() => databaseEntryInputSchema.parse({ name: "app_car", mode: "admin" })).toThrow();
  });

  // 表示名（label）は #97 で廃止した。余分なキーを渡しても結果に混ざらないことを確かめる。
  it("labelを渡してもパース結果に含まれない", () => {
    const parsed = databaseEntryInputSchema.parse({
      name: "app_car",
      label: "車両管理",
      mode: "read-only",
    });
    expect(parsed).toEqual({ name: "app_car", mode: "read-only" });
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

describe("isManagedName / assertManagedName", () => {
  it.each(["app_car", "app_asset_manager"])("%s は管理対象の名前", (name) => {
    expect(isManagedName(name)).toBe(true);
    expect(() => assertManagedName("DB名", name)).not.toThrow();
  });

  it.each(["wordpress", "app", "app_", "mysql", "APP_car"])(
    "%s は管理対象の名前ではない",
    (name) => {
      expect(isManagedName(name)).toBe(false);
      expect(() => assertManagedName("DB名", name)).toThrow();
    },
  );
});
