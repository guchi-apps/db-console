import { beforeEach, describe, expect, it, vi } from "vitest";

// 設定・DBユーザー管理の操作が済んだあとに監査ログの書き込みが失敗しても、
// 操作の成否（と、1度しか返せないパスワード）を変えないことを確かめる（#143）。

const mocks = vi.hoisted(() => ({
  auditLogCreate: vi.fn(),
  createDatabase: vi.fn(),
  createDatabaseEntry: vi.fn(),
  deleteDatabaseEntry: vi.fn(),
  getDatabaseEntry: vi.fn(),
  createDatabaseUser: vi.fn(),
  resetDatabaseUserPassword: vi.fn(),
  dropDatabaseUser: vi.fn(),
  getDatabaseUserGrant: vi.fn(),
  setDatabaseUserPrivilege: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/db", () => ({ db: { auditLog: { create: mocks.auditLogCreate } } }));
vi.mock("@/lib/session", () => ({ requireUserId: async () => "user-1" }));
vi.mock("@/lib/reauth", () => ({ isReauthValid: async () => true }));
vi.mock("@/lib/admin-db", () => ({ createDatabase: mocks.createDatabase }));
vi.mock("@/lib/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config")>()),
  createDatabaseEntry: mocks.createDatabaseEntry,
  deleteDatabaseEntry: mocks.deleteDatabaseEntry,
  getDatabaseEntry: mocks.getDatabaseEntry,
}));
vi.mock("@/lib/db-users", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db-users")>()),
  createDatabaseUser: mocks.createDatabaseUser,
  resetDatabaseUserPassword: mocks.resetDatabaseUserPassword,
  dropDatabaseUser: mocks.dropDatabaseUser,
  getDatabaseUserGrant: mocks.getDatabaseUserGrant,
  setDatabaseUserPrivilege: mocks.setDatabaseUserPrivilege,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createDatabaseAction,
  createManagedDatabaseAction,
  deleteManagedDatabaseAction,
} from "@/app/settings/actions";
import {
  createDatabaseUserAction,
  dropDatabaseUserAction,
  resetDatabaseUserPasswordAction,
  updateDatabaseUserPrivilegeAction,
} from "@/app/settings/users/actions";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

const userState = {};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
  mocks.auditLogCreate.mockResolvedValue(undefined);
});

describe("設定の操作", () => {
  const entry = { name: "app_car" };

  it("DBの作成が成功したあと監査ログの書き込みが失敗しても、設定画面へ戻り、失敗として記録しない", async () => {
    mocks.createDatabase.mockResolvedValue({ grantedAccounts: ["db_console_data"] });
    mocks.createDatabaseEntry.mockResolvedValue(entry);
    mocks.auditLogCreate.mockRejectedValue(new Error("meta db down"));

    await expect(createDatabaseAction(form({ name: "app_car" }))).rejects.toThrow(
      "NEXT_REDIRECT:/settings",
    );

    expect(mocks.auditLogCreate).toHaveBeenCalledOnce();
    expect(mocks.auditLogCreate.mock.calls[0][0].data).toMatchObject({
      action: "DATABASE_CREATE",
      status: "SUCCESS",
    });
  });

  it("DBの作成が失敗したときは失敗を記録し、エラー付きで設定画面へ戻す", async () => {
    mocks.createDatabase.mockRejectedValue(new Error("already exists"));

    await expect(createDatabaseAction(form({ name: "app_car" }))).rejects.toThrow(
      "NEXT_REDIRECT:/settings?error=already%20exists",
    );

    expect(mocks.auditLogCreate.mock.calls[0][0].data).toMatchObject({
      action: "DATABASE_CREATE",
      status: "FAILURE",
      errorMessage: "already exists",
    });
  });

  it("DBの作成が失敗し、失敗の記録も書けないときでも、エラー付きで設定画面へ戻す", async () => {
    mocks.createDatabase.mockRejectedValue(new Error("already exists"));
    mocks.auditLogCreate.mockRejectedValue(new Error("meta db down"));

    await expect(createDatabaseAction(form({ name: "app_car" }))).rejects.toThrow(
      "NEXT_REDIRECT:/settings?error=already%20exists",
    );
  });

  it("既存DBの登録が成功したあと監査ログの書き込みが失敗しても、設定画面へ戻る", async () => {
    mocks.createDatabaseEntry.mockResolvedValue(entry);
    mocks.auditLogCreate.mockRejectedValue(new Error("meta db down"));

    await expect(createManagedDatabaseAction(form({ name: "app_car" }))).rejects.toThrow(
      "NEXT_REDIRECT:/settings",
    );

    expect(mocks.auditLogCreate.mock.calls[0][0].data).toMatchObject({
      action: "MANAGED_DB_CREATE",
      databaseName: "app_car",
      status: "SUCCESS",
    });
  });

  it("管理対象からの削除が成功したあと監査ログの書き込みが失敗しても、設定画面へ戻る", async () => {
    mocks.deleteDatabaseEntry.mockResolvedValue(undefined);
    mocks.auditLogCreate.mockRejectedValue(new Error("meta db down"));

    await expect(deleteManagedDatabaseAction(form({ name: "app_car" }))).rejects.toThrow(
      "NEXT_REDIRECT:/settings",
    );

    expect(mocks.auditLogCreate.mock.calls[0][0].data).toMatchObject({
      action: "MANAGED_DB_DELETE",
      status: "SUCCESS",
    });
  });

  it("管理対象からの削除が失敗したときは失敗を記録し、エラー付きで戻す", async () => {
    mocks.deleteDatabaseEntry.mockRejectedValue(new Error("not found"));

    await expect(deleteManagedDatabaseAction(form({ name: "app_car" }))).rejects.toThrow(
      "NEXT_REDIRECT:/settings?error=not%20found",
    );

    expect(mocks.auditLogCreate.mock.calls[0][0].data.status).toBe("FAILURE");
  });
});

describe("DBユーザーの管理", () => {
  const account = form({ name: "app_car_rw", host: "localhost" });

  it("ユーザーの作成が成功したあと監査ログの書き込みが失敗しても、パスワードを返す", async () => {
    mocks.createDatabaseUser.mockResolvedValue({ password: "secret-once" });
    mocks.auditLogCreate.mockRejectedValue(new Error("meta db down"));

    const state = await createDatabaseUserAction(userState, account);

    expect(state).toEqual({ password: "secret-once", account: "app_car_rw@localhost" });
    expect(mocks.auditLogCreate).toHaveBeenCalledOnce();
    expect(mocks.auditLogCreate.mock.calls[0][0].data).toMatchObject({
      action: "DB_USER_CREATE",
      status: "SUCCESS",
    });
  });

  it("ユーザーの作成が失敗したときは失敗を記録し、エラーを返す", async () => {
    mocks.createDatabaseUser.mockRejectedValue(new Error("exists"));

    const state = await createDatabaseUserAction(userState, account);

    expect(state).toEqual({ error: "exists" });
    expect(mocks.auditLogCreate.mock.calls[0][0].data.status).toBe("FAILURE");
  });

  it("ユーザーの作成が失敗し、失敗の記録も書けないときでも、エラーを返す", async () => {
    mocks.createDatabaseUser.mockRejectedValue(new Error("exists"));
    mocks.auditLogCreate.mockRejectedValue(new Error("meta db down"));

    await expect(createDatabaseUserAction(userState, account)).resolves.toEqual({
      error: "exists",
    });
  });

  it("パスワードの再発行が成功したあと監査ログの書き込みが失敗しても、パスワードを返す", async () => {
    mocks.resetDatabaseUserPassword.mockResolvedValue({ password: "secret-again" });
    mocks.auditLogCreate.mockRejectedValue(new Error("meta db down"));

    const state = await resetDatabaseUserPasswordAction(userState, account);

    expect(state).toEqual({ password: "secret-again", account: "app_car_rw@localhost" });
    expect(mocks.auditLogCreate.mock.calls[0][0].data).toMatchObject({
      action: "DB_USER_PASSWORD_RESET",
      status: "SUCCESS",
    });
  });

  it("ユーザーの削除が成功したあと監査ログの書き込みが失敗しても、一覧へ戻る", async () => {
    mocks.dropDatabaseUser.mockResolvedValue(undefined);
    mocks.auditLogCreate.mockRejectedValue(new Error("meta db down"));

    await expect(dropDatabaseUserAction(account)).rejects.toThrow(
      "NEXT_REDIRECT:/settings/users",
    );

    expect(mocks.auditLogCreate.mock.calls[0][0].data).toMatchObject({
      action: "DB_USER_DROP",
      status: "SUCCESS",
    });
  });

  it("ユーザーの削除が失敗したときは失敗を記録し、エラー付きで戻す", async () => {
    mocks.dropDatabaseUser.mockRejectedValue(new Error("in use"));

    await expect(dropDatabaseUserAction(account)).rejects.toThrow(
      "NEXT_REDIRECT:/settings/users?error=in%20use",
    );

    expect(mocks.auditLogCreate.mock.calls[0][0].data.status).toBe("FAILURE");
  });

  describe("権限の変更", () => {
    const grantForm = () =>
      form({ name: "app_car_rw", host: "localhost", database: "app_car", preset: "read-write" });

    beforeEach(() => {
      mocks.getDatabaseEntry.mockResolvedValue({ name: "app_car" });
      mocks.getDatabaseUserGrant.mockResolvedValue({ preset: "read-only", privileges: ["SELECT"] });
    });

    it("権限の変更が成功したあと監査ログの書き込みが失敗しても、一覧へ戻る", async () => {
      mocks.setDatabaseUserPrivilege.mockResolvedValue(undefined);
      mocks.auditLogCreate.mockRejectedValue(new Error("meta db down"));

      await expect(updateDatabaseUserPrivilegeAction(grantForm())).rejects.toThrow(
        "NEXT_REDIRECT:/settings/users",
      );

      expect(mocks.auditLogCreate).toHaveBeenCalledOnce();
      expect(mocks.auditLogCreate.mock.calls[0][0].data).toMatchObject({
        action: "DB_USER_GRANT",
        databaseName: "app_car",
        status: "SUCCESS",
      });
    });

    it("権限の変更が失敗したときは失敗を記録し、エラー付きで戻す", async () => {
      mocks.setDatabaseUserPrivilege.mockRejectedValue(new Error("denied"));

      await expect(updateDatabaseUserPrivilegeAction(grantForm())).rejects.toThrow(
        "NEXT_REDIRECT:/settings/users?error=denied",
      );

      expect(mocks.auditLogCreate.mock.calls[0][0].data.status).toBe("FAILURE");
    });
  });
});
