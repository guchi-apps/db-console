import { beforeEach, describe, expect, it, vi } from "vitest";

// 操作の実行後に履歴・監査ログの書き込みが失敗しても、操作の成否を変えないことを確かめる（#135）。

const mocks = vi.hoisted(() => ({
  auditLogCreate: vi.fn(),
  sqlHistoryCreate: vi.fn(),
  executeSql: vi.fn(),
  insertRow: vi.fn(),
  dropTable: vi.fn(),
  getTableColumns: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    auditLog: { create: mocks.auditLogCreate },
    sqlHistory: { create: mocks.sqlHistoryCreate },
  },
}));
vi.mock("@/lib/session", () => ({ requireUserId: async () => "user-1" }));
vi.mock("@/lib/reauth", () => ({
  isReauthValid: async () => true,
  assertSchemaChangeReauth: async () => {},
}));
vi.mock("@/lib/sql-execute", () => ({ executeSql: mocks.executeSql }));
vi.mock("@/lib/introspection", () => ({
  getTableColumns: mocks.getTableColumns,
  insertRow: mocks.insertRow,
  updateRow: vi.fn(),
  deleteRows: vi.fn(),
  dropTable: mocks.dropTable,
  renameTable: vi.fn(),
  truncateTable: vi.fn(),
}));
vi.mock("@/lib/row-form", () => ({ buildRowDataFromForm: () => ({ name: "a" }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { writeAuditLogSafely } from "@/lib/audit";
import { executeSqlAction } from "@/app/databases/[db]/sql/actions";
import { createRowAction } from "@/app/databases/[db]/tables/[table]/actions";
import { dropTableAction } from "@/app/databases/[db]/tables/[table]/schema-actions";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

const sqlState = { sql: "" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.auditLogCreate.mockResolvedValue(undefined);
  mocks.sqlHistoryCreate.mockResolvedValue(undefined);
  mocks.getTableColumns.mockResolvedValue([]);
});

describe("writeAuditLogSafely", () => {
  it("書き込みに失敗しても例外を投げず、console.error に残す", async () => {
    mocks.auditLogCreate.mockRejectedValue(new Error("meta db down"));

    await expect(
      writeAuditLogSafely({
        userId: "user-1",
        action: "SQL_EXECUTE",
        databaseName: "app_car",
        status: "SUCCESS",
      }),
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledOnce();
  });
});

describe("executeSqlAction", () => {
  const result = {
    queryType: "UPDATE",
    durationMs: 3,
    columns: [],
    rows: [],
    affectedRows: 2,
  };

  it("SQLが成功したあと履歴の書き込みが失敗しても、成功として返し、失敗の記録を残さない", async () => {
    mocks.executeSql.mockResolvedValue(result);
    mocks.sqlHistoryCreate.mockRejectedValue(new Error("meta db down"));

    const state = await executeSqlAction(
      sqlState,
      form({ __db: "app_car", sql: "UPDATE t SET a = 1" }),
    );

    expect(state.error).toBeUndefined();
    expect(state.result).toEqual(result);
    // 履歴の書き込みが落ちても監査ログは書く。失敗として記録し直すこともしない。
    expect(mocks.auditLogCreate).toHaveBeenCalledOnce();
    expect(mocks.auditLogCreate.mock.calls[0][0].data.status).toBe("SUCCESS");
    expect(mocks.sqlHistoryCreate).toHaveBeenCalledOnce();
    expect(mocks.sqlHistoryCreate.mock.calls[0][0].data.status).toBe("SUCCESS");
  });

  it("SQLが成功したあと監査ログの書き込みが失敗しても、成功として返す", async () => {
    mocks.executeSql.mockResolvedValue(result);
    mocks.auditLogCreate.mockRejectedValue(new Error("meta db down"));

    const state = await executeSqlAction(
      sqlState,
      form({ __db: "app_car", sql: "UPDATE t SET a = 1" }),
    );

    expect(state.error).toBeUndefined();
    expect(state.result).toEqual(result);
    expect(mocks.sqlHistoryCreate).toHaveBeenCalledOnce();
  });

  it("SQLが失敗したときは失敗として履歴・監査ログに残し、エラーを返す", async () => {
    mocks.executeSql.mockRejectedValue(new Error("syntax error"));

    const state = await executeSqlAction(
      sqlState,
      form({ __db: "app_car", sql: "UPDATE t SET" }),
    );

    expect(state.error).toBe("syntax error");
    expect(mocks.sqlHistoryCreate.mock.calls[0][0].data).toMatchObject({
      status: "FAILURE",
      queryType: "OTHER",
      errorMessage: "syntax error",
    });
    expect(mocks.auditLogCreate.mock.calls[0][0].data.status).toBe("FAILURE");
  });

  it("SQLが失敗し、失敗の記録も書けないときでも、SQLのエラーを返す", async () => {
    mocks.executeSql.mockRejectedValue(new Error("syntax error"));
    mocks.sqlHistoryCreate.mockRejectedValue(new Error("meta db down"));
    mocks.auditLogCreate.mockRejectedValue(new Error("meta db down"));

    const state = await executeSqlAction(
      sqlState,
      form({ __db: "app_car", sql: "UPDATE t SET" }),
    );

    expect(state.error).toBe("syntax error");
  });
});

describe("レコード操作", () => {
  it("追加が成功したあと監査ログの書き込みが失敗しても、一覧へ戻り、失敗として記録しない", async () => {
    mocks.insertRow.mockResolvedValue({ affectedRows: 1 });
    mocks.auditLogCreate.mockRejectedValue(new Error("meta db down"));

    await expect(
      createRowAction(form({ __db: "app_car", __table: "cars" })),
    ).rejects.toThrow("NEXT_REDIRECT:/databases/app_car/tables/cars");

    expect(mocks.auditLogCreate).toHaveBeenCalledOnce();
    expect(mocks.auditLogCreate.mock.calls[0][0].data).toMatchObject({
      action: "ROW_INSERT",
      status: "SUCCESS",
      affectedRows: 1,
    });
  });

  it("追加が失敗したときは失敗を記録し、エラー付きで入力画面へ戻す", async () => {
    mocks.insertRow.mockRejectedValue(new Error("duplicate"));

    await expect(
      createRowAction(form({ __db: "app_car", __table: "cars" })),
    ).rejects.toThrow("NEXT_REDIRECT:/databases/app_car/tables/cars/new?error=duplicate");

    expect(mocks.auditLogCreate.mock.calls[0][0].data.status).toBe("FAILURE");
  });

  it("追加が失敗し、失敗の記録も書けないときでも、エラー付きで入力画面へ戻す", async () => {
    mocks.insertRow.mockRejectedValue(new Error("duplicate"));
    mocks.auditLogCreate.mockRejectedValue(new Error("meta db down"));

    await expect(
      createRowAction(form({ __db: "app_car", __table: "cars" })),
    ).rejects.toThrow("NEXT_REDIRECT:/databases/app_car/tables/cars/new?error=duplicate");
  });
});

describe("構造の変更", () => {
  const dropForm = () =>
    form({ __db: "app_car", __table: "cars", confirmName: "cars" });

  it("テーブルの削除が成功したあと監査ログの書き込みが失敗しても、一覧へ戻る", async () => {
    mocks.dropTable.mockResolvedValue(undefined);
    mocks.auditLogCreate.mockRejectedValue(new Error("meta db down"));

    await expect(dropTableAction(dropForm())).rejects.toThrow(
      "NEXT_REDIRECT:/databases/app_car/tables",
    );

    expect(mocks.auditLogCreate).toHaveBeenCalledOnce();
    expect(mocks.auditLogCreate.mock.calls[0][0].data).toMatchObject({
      action: "TABLE_DROP",
      status: "SUCCESS",
    });
  });

  it("テーブルの削除が失敗したときは失敗を記録し、エラー付きで戻す", async () => {
    mocks.dropTable.mockRejectedValue(new Error("locked"));

    await expect(dropTableAction(dropForm())).rejects.toThrow(
      "NEXT_REDIRECT:/databases/app_car/tables/cars/danger?error=locked",
    );

    expect(mocks.auditLogCreate.mock.calls[0][0].data.status).toBe("FAILURE");
  });
});
