import { beforeEach, describe, expect, it, vi } from "vitest";

// 「既存DBを登録」の画面はメタデータDB（DB_NAME）を選択肢から除いているが、細工したPOSTでは
// サーバーアクションへ直接届く。登録の経路（createDatabaseEntry）そのものが拒否することを確かめる（#140）。

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  auditLogCreate: vi.fn(),
  createDatabase: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    managedDatabase: {
      findUnique: mocks.findUnique,
      create: mocks.create,
      update: mocks.update,
    },
    auditLog: { create: mocks.auditLogCreate },
  },
}));
vi.mock("@/lib/session", () => ({ requireUserId: async () => "user-1" }));
vi.mock("@/lib/reauth", () => ({ isReauthValid: async () => true }));
vi.mock("@/lib/admin-db", () => ({ createDatabase: mocks.createDatabase }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createManagedDatabaseAction, createDatabaseAction } from "@/app/settings/actions";
import { createDatabaseEntry } from "@/lib/config";

function form(name: string): FormData {
  const data = new FormData();
  data.set("name", name);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
  mocks.auditLogCreate.mockResolvedValue(undefined);
  mocks.findUnique.mockResolvedValue(null);
  mocks.create.mockImplementation(async ({ data }: { data: { name: string } }) => data);
  vi.stubEnv("DB_NAME", "app_db_console");
});

describe("メタデータDB（DB_NAME）の登録拒否", () => {
  it("createDatabaseEntry は登録せずに拒否する", async () => {
    await expect(createDatabaseEntry({ name: "app_db_console" })).rejects.toThrow();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("除外中の行があっても、除外を解除して登録し直せない", async () => {
    mocks.findUnique.mockResolvedValue({ name: "app_db_console", excludedAt: new Date() });

    await expect(createDatabaseEntry({ name: "app_db_console" })).rejects.toThrow();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("「既存DBを登録」のアクションは、細工したPOSTでも登録せず、失敗を記録してエラー付きで戻す", async () => {
    await expect(createManagedDatabaseAction(form("app_db_console"))).rejects.toThrow(
      /NEXT_REDIRECT:\/settings\?error=/,
    );

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate.mock.calls[0][0].data).toMatchObject({
      action: "MANAGED_DB_CREATE",
      databaseName: "app_db_console",
      status: "FAILURE",
    });
  });

  it("「DBを作成」のアクションも、メタデータDBの名前では何も作らない", async () => {
    await expect(createDatabaseAction(form("app_db_console"))).rejects.toThrow(
      /NEXT_REDIRECT:\/settings\?error=/,
    );

    expect(mocks.createDatabase).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("メタデータDB以外のDBは登録できる", async () => {
    await expect(createDatabaseEntry({ name: "app_car" })).resolves.toEqual({ name: "app_car" });
    expect(mocks.create).toHaveBeenCalledWith({ data: { name: "app_car" } });
  });
});
