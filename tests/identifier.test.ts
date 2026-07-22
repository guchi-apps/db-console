import { describe, expect, it } from "vitest";
import {
  InvalidIdentifierError,
  qualifyTable,
  quoteColumn,
  quoteIdentifier,
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
