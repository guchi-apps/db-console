import { describe, expect, it } from "vitest";

import { describeColumnDefault, parseColumnDefault } from "@/lib/column-default";
import {
  buildModifyColumnSql,
  UnsupportedColumnAttributeError,
  type ColumnModificationSqlInput,
  type CurrentColumnDefinition,
} from "@/lib/column-definition";

const TABLE = "`app_x`.`t`";

function current(overrides: Partial<CurrentColumnDefinition> = {}): CurrentColumnDefinition {
  return {
    name: "c",
    columnType: "int(11)",
    columnDefault: null,
    extra: "",
    characterSetName: null,
    collationName: null,
    ...overrides,
  };
}

function input(overrides: Partial<ColumnModificationSqlInput> = {}): ColumnModificationSqlInput {
  return { sqlType: null, nullable: false, default: { mode: "keep" }, ...overrides };
}

describe("parseColumnDefault（MariaDB の column_default の解釈）", () => {
  it("SQLの NULL はデフォルトなし、文字列 NULL は NULL がデフォルト", () => {
    expect(parseColumnDefault(null)).toEqual({ kind: "none" });
    expect(parseColumnDefault("NULL")).toEqual({ kind: "null" });
  });

  it("引用符付きの文字列リテラルは中身を取り出す", () => {
    expect(parseColumnDefault("'abc'")).toEqual({ kind: "literal", value: "abc", sql: "'abc'" });
    expect(parseColumnDefault("'it''s'")).toEqual({ kind: "literal", value: "it's", sql: "'it''s'" });
    expect(parseColumnDefault("''")).toEqual({ kind: "literal", value: "", sql: "''" });
    expect(parseColumnDefault("'a\\\\b'")).toMatchObject({ kind: "literal", value: "a\\b" });
    expect(parseColumnDefault("'NULL'")).toMatchObject({ kind: "literal", value: "NULL" });
  });

  it("数値・BITのリテラルはそのまま", () => {
    expect(parseColumnDefault("0")).toEqual({ kind: "literal", value: "0", sql: "0" });
    expect(parseColumnDefault("-1.50")).toMatchObject({ kind: "literal", sql: "-1.50" });
    expect(parseColumnDefault("b'101'")).toMatchObject({ kind: "literal", sql: "b'101'" });
  });

  it("current_timestamp() は精度を保って正規化する", () => {
    expect(parseColumnDefault("current_timestamp()")).toEqual({
      kind: "current_timestamp",
      sql: "CURRENT_TIMESTAMP",
    });
    expect(parseColumnDefault("current_timestamp(3)")).toEqual({
      kind: "current_timestamp",
      sql: "CURRENT_TIMESTAMP(3)",
    });
  });

  it("それ以外の式は expression として区別する", () => {
    expect(parseColumnDefault("uuid()")).toEqual({ kind: "expression", sql: "uuid()" });
    expect(parseColumnDefault("'a' OR 1")).toEqual({ kind: "expression", sql: "'a' OR 1" });
  });

  it("画面に出す説明", () => {
    expect(describeColumnDefault(parseColumnDefault(null))).toBe("なし");
    expect(describeColumnDefault(parseColumnDefault("NULL"))).toBe("NULL");
    expect(describeColumnDefault(parseColumnDefault("'abc'"))).toBe("abc");
  });
});

describe("buildModifyColumnSql（属性の引き継ぎ）", () => {
  it("AUTO_INCREMENT を引き継ぐ（コメントを変えただけで外れない）", () => {
    const sql = buildModifyColumnSql(
      TABLE,
      current({ name: "id", extra: "auto_increment" }),
      input({ comment: "ID" }),
    );
    expect(sql).toBe(
      "ALTER TABLE `app_x`.`t` MODIFY COLUMN `id` int(11) NOT NULL AUTO_INCREMENT COMMENT 'ID'",
    );
  });

  it("ON UPDATE current_timestamp() を精度つきで引き継ぐ", () => {
    const sql = buildModifyColumnSql(
      TABLE,
      current({
        name: "updated_at",
        columnType: "datetime(3)",
        columnDefault: "current_timestamp(3)",
        extra: "on update current_timestamp(3)",
      }),
      input(),
    );
    expect(sql).toBe(
      "ALTER TABLE `app_x`.`t` MODIFY COLUMN `updated_at` datetime(3) NOT NULL" +
        " DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)",
    );
  });

  it("INVISIBLE を引き継ぐ", () => {
    const sql = buildModifyColumnSql(TABLE, current({ extra: "INVISIBLE" }), input({ nullable: true }));
    expect(sql).toBe("ALTER TABLE `app_x`.`t` MODIFY COLUMN `c` int(11) NULL INVISIBLE");
  });

  it("カラム単位の文字セット・照合順序を引き継ぐ", () => {
    const sql = buildModifyColumnSql(
      TABLE,
      current({
        columnType: "varchar(50)",
        characterSetName: "latin1",
        collationName: "latin1_bin",
      }),
      input({ nullable: true }),
    );
    expect(sql).toBe(
      "ALTER TABLE `app_x`.`t` MODIFY COLUMN `c` varchar(50) CHARACTER SET latin1 COLLATE latin1_bin NULL",
    );
  });

  it("文字列型どうしの型変更でも文字セットを引き継ぐ", () => {
    const sql = buildModifyColumnSql(
      TABLE,
      current({ columnType: "varchar(50)", characterSetName: "utf8mb4", collationName: "utf8mb4_bin" }),
      input({ sqlType: "TEXT" }),
    );
    expect(sql).toContain("MODIFY COLUMN `c` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL");
  });

  it("文字列以外の型へ変えるときは文字セットを付けない", () => {
    const sql = buildModifyColumnSql(
      TABLE,
      current({ columnType: "varchar(50)", characterSetName: "utf8mb4", collationName: "utf8mb4_bin" }),
      input({ sqlType: "INT" }),
    );
    expect(sql).toBe("ALTER TABLE `app_x`.`t` MODIFY COLUMN `c` INT NOT NULL");
  });

  it("生成列は変更を拒否する（生成式が失われるため）", () => {
    expect(() =>
      buildModifyColumnSql(TABLE, current({ extra: "VIRTUAL GENERATED" }), input()),
    ).toThrow(UnsupportedColumnAttributeError);
  });

  it("引き継ぎ方の分からない属性があれば拒否する", () => {
    expect(() =>
      buildModifyColumnSql(TABLE, current({ extra: "DEFAULT_GENERATED" }), input()),
    ).toThrow(UnsupportedColumnAttributeError);
  });

  it("並び順を付ける", () => {
    expect(buildModifyColumnSql(TABLE, current(), input({ position: "first" }))).toMatch(/ FIRST$/);
    expect(buildModifyColumnSql(TABLE, current(), input({ position: { after: "id" } }))).toMatch(
      / AFTER `id`$/,
    );
  });
});

describe("buildModifyColumnSql（デフォルト値）", () => {
  const text = current({ columnType: "varchar(20)" });

  it("変更しない: 引用符付きリテラルを二重に引用しない", () => {
    const sql = buildModifyColumnSql(TABLE, { ...text, columnDefault: "'abc'" }, input());
    expect(sql).toBe("ALTER TABLE `app_x`.`t` MODIFY COLUMN `c` varchar(20) NOT NULL DEFAULT 'abc'");
  });

  it("変更しない: NULL デフォルトを文字列 'NULL' にしない", () => {
    const sql = buildModifyColumnSql(
      TABLE,
      { ...text, columnDefault: "NULL" },
      input({ nullable: true }),
    );
    expect(sql).toBe("ALTER TABLE `app_x`.`t` MODIFY COLUMN `c` varchar(20) NULL DEFAULT NULL");
  });

  it("変更しない: NOT NULL へ変えるときは NULL デフォルトを付けない", () => {
    const sql = buildModifyColumnSql(TABLE, { ...text, columnDefault: "NULL" }, input());
    expect(sql).toBe("ALTER TABLE `app_x`.`t` MODIFY COLUMN `c` varchar(20) NOT NULL");
  });

  it("変更しない: current_timestamp() を文字列にしない", () => {
    const sql = buildModifyColumnSql(
      TABLE,
      current({ columnType: "datetime", columnDefault: "current_timestamp()" }),
      input(),
    );
    expect(sql).toBe(
      "ALTER TABLE `app_x`.`t` MODIFY COLUMN `c` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP",
    );
  });

  it("変更しない: デフォルトなしは DEFAULT を付けない", () => {
    expect(buildModifyColumnSql(TABLE, text, input())).toBe(
      "ALTER TABLE `app_x`.`t` MODIFY COLUMN `c` varchar(20) NOT NULL",
    );
  });

  it("変更しない: 引き継げない式のデフォルトは拒否する", () => {
    expect(() =>
      buildModifyColumnSql(TABLE, { ...text, columnDefault: "uuid()" }, input()),
    ).toThrow(UnsupportedColumnAttributeError);
  });

  it("値を指定: エスケープして送る（空文字も DEFAULT '' になる）", () => {
    expect(
      buildModifyColumnSql(TABLE, text, input({ default: { mode: "value", value: "it's" } })),
    ).toContain("DEFAULT 'it\\'s'");
    expect(
      buildModifyColumnSql(TABLE, text, input({ default: { mode: "value", value: "" } })),
    ).toContain("NOT NULL DEFAULT ''");
  });

  it("NULL・なし・CURRENT_TIMESTAMP を選べる", () => {
    const withDefault = { ...text, columnDefault: "'abc'" };
    expect(
      buildModifyColumnSql(TABLE, withDefault, input({ nullable: true, default: { mode: "null" } })),
    ).toBe("ALTER TABLE `app_x`.`t` MODIFY COLUMN `c` varchar(20) NULL DEFAULT NULL");
    expect(buildModifyColumnSql(TABLE, withDefault, input({ default: { mode: "none" } }))).toBe(
      "ALTER TABLE `app_x`.`t` MODIFY COLUMN `c` varchar(20) NOT NULL",
    );
    expect(
      buildModifyColumnSql(
        TABLE,
        current({ columnType: "timestamp(6)" }),
        input({ default: { mode: "current_timestamp" } }),
      ),
    ).toBe(
      "ALTER TABLE `app_x`.`t` MODIFY COLUMN `c` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)",
    );
  });
});
