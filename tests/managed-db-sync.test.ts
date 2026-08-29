import { afterEach, describe, expect, it } from "vitest";

import { AUTO_REGISTER_MODE, isAutoRegistrableDatabase } from "@/lib/managed-db-sync";

const originalDbName = process.env.DB_NAME;

afterEach(() => {
  if (originalDbName === undefined) {
    delete process.env.DB_NAME;
  } else {
    process.env.DB_NAME = originalDbName;
  }
});

describe("isAutoRegistrableDatabase", () => {
  it("app_ で始まるDBを自動登録の対象にする", () => {
    expect(isAutoRegistrableDatabase("app_car")).toBe(true);
  });

  it.each(["wordpress", "mysql", "appcar", "app_"])(
    "app_ で始まらないDBは対象外にする: %s",
    (name) => {
      expect(isAutoRegistrableDatabase(name)).toBe(false);
    },
  );

  it("db-console 自身のメタデータDBは対象外にする", () => {
    process.env.DB_NAME = "app_db_console";
    expect(isAutoRegistrableDatabase("app_db_console")).toBe(false);
    expect(isAutoRegistrableDatabase("app_car")).toBe(true);
  });
});

describe("AUTO_REGISTER_MODE", () => {
  // 自動登録は「DBを新規作成」フォームの既定と同じ強さにする（#97）。
  it("データ編集可で登録する", () => {
    expect(AUTO_REGISTER_MODE).toBe("data-write");
  });
});
