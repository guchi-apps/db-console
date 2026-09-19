import { describe, expect, it } from "vitest";

import type { ColumnInfo } from "@/lib/introspection";
import {
  buildRowDataFromForm,
  dateTimeStepFor,
  formatValueForInput,
  toDatabaseDateTime,
  toDateTimeInputValue,
} from "@/lib/row-form";
import { createTargetPool } from "@/lib/target-db";

function column(overrides: Partial<ColumnInfo> & Pick<ColumnInfo, "name" | "dataType">): ColumnInfo {
  return {
    columnType: overrides.dataType,
    isNullable: true,
    columnDefault: null,
    extra: "",
    columnKey: "",
    comment: null,
    ordinalPosition: 1,
    characterSetName: null,
    collationName: null,
    ...overrides,
  };
}

function form(values: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

describe("toDateTimeInputValue / toDatabaseDateTime", () => {
  it("DBの日時文字列を秒つきのまま datetime-local 用（T区切り）へ変換する", () => {
    expect(toDateTimeInputValue("2026-01-02 12:34:56")).toBe("2026-01-02T12:34:56");
  });

  it("小数秒を落とさない", () => {
    expect(toDateTimeInputValue("2026-01-02 12:34:56.789")).toBe("2026-01-02T12:34:56.789");
  });

  it("秒が無い値は :00 を補う", () => {
    expect(toDateTimeInputValue("2026-01-02 12:34")).toBe("2026-01-02T12:34:00");
  });

  it("表示できないゼロ日付は空にする", () => {
    expect(toDateTimeInputValue("0000-00-00 00:00:00")).toBe("");
  });

  it("フォームの入力値をDBの日時文字列へ戻す（往復で値が変わらない）", () => {
    const dbValue = "2026-01-02 12:34:56";
    expect(toDatabaseDateTime(toDateTimeInputValue(dbValue))).toBe(dbValue);
  });

  it("ブラウザが秒を省いた値には :00 を補う", () => {
    expect(toDatabaseDateTime("2026-01-02T12:34")).toBe("2026-01-02 12:34:00");
  });

  it("形式が合わない値はそのまま返す（判断はDBに任せる）", () => {
    expect(toDatabaseDateTime("not-a-date")).toBe("not-a-date");
  });
});

describe("dateTimeStepFor", () => {
  it.each([
    ["datetime", "1"],
    ["timestamp", "1"],
    ["datetime(0)", "1"],
    ["datetime(1)", "0.1"],
    ["datetime(3)", "0.001"],
    ["timestamp(6)", "0.000001"],
  ])("%s は step=%s", (columnType, expected) => {
    expect(dateTimeStepFor(columnType)).toBe(expected);
  });
});

describe("formatValueForInput", () => {
  it("DATE は文字列のまま返す（TZで前日にならない）", () => {
    expect(formatValueForInput("2026-01-02", "date")).toBe("2026-01-02");
  });

  it("ゼロ日付は空にする", () => {
    expect(formatValueForInput("0000-00-00", "date")).toBe("");
  });

  it("DATETIME は秒まで残す", () => {
    expect(formatValueForInput("2026-01-02 12:34:56", "datetime-local")).toBe(
      "2026-01-02T12:34:56",
    );
  });

  it("NULL は空文字にする", () => {
    expect(formatValueForInput(null, "datetime-local")).toBe("");
  });
});

describe("buildRowDataFromForm（INSERT: 現在の行を渡さない）", () => {
  const columns = [
    column({ name: "id", dataType: "int", extra: "auto_increment" }),
    column({ name: "title", dataType: "varchar", isNullable: false }),
    column({ name: "note", dataType: "varchar" }),
    column({ name: "starts_at", dataType: "datetime" }),
    column({ name: "done", dataType: "tinyint", columnType: "tinyint(1)" }),
  ];

  it("auto_increment を除き、日時は秒つきのDB形式へ変換する", () => {
    const data = buildRowDataFromForm(
      form({ title: " a ", note: "", starts_at: "2026-01-02T12:34:56", done: "on" }),
      columns,
    );
    expect(data).toEqual({ title: "a", note: null, starts_at: "2026-01-02 12:34:56", done: 1 });
  });

  it("NOT NULLで空欄のカラムは含めない", () => {
    const data = buildRowDataFromForm(form({ title: "", starts_at: "" }), columns);
    expect(data).not.toHaveProperty("title");
    expect(data.starts_at).toBeNull();
  });
});

describe("buildRowDataFromForm（UPDATE: 現在の行との差分だけ返す）", () => {
  const columns = [
    column({ name: "id", dataType: "int", extra: "auto_increment" }),
    column({ name: "title", dataType: "varchar", isNullable: false }),
    column({ name: "body", dataType: "text" }),
    column({ name: "starts_at", dataType: "datetime" }),
    column({ name: "due_on", dataType: "date" }),
    column({ name: "done", dataType: "tinyint", columnType: "tinyint(1)" }),
  ];
  const currentRow = {
    id: 1,
    title: "タイトル",
    body: "1行目\n2行目",
    starts_at: "2026-01-02 12:34:56",
    due_on: "2026-01-02",
    done: 1,
  };
  // 何も触らずに保存したときにブラウザが送る値。
  const untouched = {
    title: "タイトル",
    body: "1行目\r\n2行目",
    starts_at: "2026-01-02T12:34:56",
    due_on: "2026-01-02",
    done: "on",
  };

  it("何も変えなければ空になる（秒・改行が変わらない）", () => {
    expect(buildRowDataFromForm(form(untouched), columns, currentRow)).toEqual({});
  });

  it("別のカラムだけ直しても、日時カラムはUPDATEに含めない", () => {
    const data = buildRowDataFromForm(form({ ...untouched, title: "新しい" }), columns, currentRow);
    expect(data).toEqual({ title: "新しい" });
  });

  it("秒が 0 のときにブラウザが秒を省いても、変更とは見なさない", () => {
    const data = buildRowDataFromForm(
      form({ ...untouched, starts_at: "2026-01-02T12:34" }),
      columns,
      { ...currentRow, starts_at: "2026-01-02 12:34:00" },
    );
    expect(data).toEqual({});
  });

  it("日時を直したときは秒つきのDB形式で返す", () => {
    const data = buildRowDataFromForm(
      form({ ...untouched, starts_at: "2026-01-02T13:00:30" }),
      columns,
      currentRow,
    );
    expect(data).toEqual({ starts_at: "2026-01-02 13:00:30" });
  });

  it("nullable のカラムを空にしたら NULL を返す", () => {
    const data = buildRowDataFromForm(form({ ...untouched, due_on: "" }), columns, currentRow);
    expect(data).toEqual({ due_on: null });
  });

  it("チェックボックスの切り替えを差分として拾う", () => {
    const withoutDone: Record<string, string> = { ...untouched };
    delete withoutDone.done;
    const data = buildRowDataFromForm(form(withoutDone), columns, currentRow);
    expect(data).toEqual({ done: 0 });
  });

  it("表示できないゼロ日付のカラムは、空のまま送られても触らない", () => {
    const data = buildRowDataFromForm(
      form({ ...untouched, starts_at: "" }),
      columns,
      { ...currentRow, starts_at: "0000-00-00 00:00:00" },
    );
    expect(data).toEqual({});
  });
});

describe("createTargetPool", () => {
  it("日付・日時を文字列のまま扱う（dateStrings: true）", async () => {
    // mysql2 のプールは最初のクエリまで接続しないため、設定の確認だけならDBは要らない。
    const pool = createTargetPool("user", "pass");
    try {
      const config = (pool as unknown as { pool: { config: { connectionConfig: object } } }).pool
        .config.connectionConfig;
      expect(config).toMatchObject({ dateStrings: true });
    } finally {
      await pool.end();
    }
  });
});
