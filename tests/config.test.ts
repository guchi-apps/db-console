import { describe, expect, it } from "vitest";
import {
  databaseEntryInputSchema,
  databaseNameSchema,
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
    const parsed = databaseEntryInputSchema.parse({
      name: "app_car",
      label: "車両管理",
      mode: "data-write",
    });
    expect(parsed).toEqual({ name: "app_car", label: "車両管理", mode: "data-write" });
  });

  it("不正なmodeを拒否する", () => {
    expect(() =>
      databaseEntryInputSchema.parse({ name: "app_car", label: "車両管理", mode: "admin" }),
    ).toThrow();
  });

  it("空のlabelを拒否する", () => {
    expect(() =>
      databaseEntryInputSchema.parse({ name: "app_car", label: "", mode: "read-only" }),
    ).toThrow();
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
