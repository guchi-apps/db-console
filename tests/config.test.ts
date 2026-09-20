import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertManagedName,
  databaseEntryInputSchema,
  databaseNameSchema,
  isManagedName,
} from "@/lib/config";

const originalDbName = process.env.DB_NAME;

beforeEach(() => {
  delete process.env.DB_NAME;
});

afterEach(() => {
  if (originalDbName === undefined) {
    delete process.env.DB_NAME;
  } else {
    process.env.DB_NAME = originalDbName;
  }
});

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

  // 画面の選択肢では除いていても、細工したPOSTで届くため、サーバー側の検証でも拒否する（#140）。
  it("メタデータDB（DB_NAME）を拒否し、他のDB名は受け付ける", () => {
    process.env.DB_NAME = "app_db_console";
    expect(() => databaseNameSchema.parse("app_db_console")).toThrow(
      "メタデータDBは管理対象に指定できません",
    );
    expect(databaseNameSchema.parse("app_car")).toBe("app_car");
  });

  it("DB_NAME が未設定でも、他のDB名を巻き込まない", () => {
    expect(databaseNameSchema.parse("app_db_console")).toBe("app_db_console");
  });

  it.each(["app-car", "app car", "app.car", "app`car", ""])(
    "不正な文字を含むDB名 %s を拒否する",
    (name) => {
      expect(() => databaseNameSchema.parse(name)).toThrow();
    },
  );
});

describe("databaseEntryInputSchema", () => {
  it("正しい入力をパースできる", () => {
    expect(databaseEntryInputSchema.parse({ name: "app_car" })).toEqual({ name: "app_car" });
  });

  it("不正なDB名を拒否する", () => {
    expect(() => databaseEntryInputSchema.parse({ name: "app-car" })).toThrow();
  });

  it("メタデータDB（DB_NAME）を拒否する", () => {
    process.env.DB_NAME = "app_db_console";
    expect(() => databaseEntryInputSchema.parse({ name: "app_db_console" })).toThrow();
  });

  // 表示名（label）は #97 で、操作モード（mode）は #105 で廃止した。
  // 余分なキーを渡しても結果に混ざらないことを確かめる。
  it("廃止したlabel・modeを渡してもパース結果に含まれない", () => {
    const parsed = databaseEntryInputSchema.parse({
      name: "app_car",
      label: "車両管理",
      mode: "read-only",
    });
    expect(parsed).toEqual({ name: "app_car" });
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
