import { beforeEach, describe, expect, it, vi } from "vitest";

// 許可リストに無い・除外中のDBは、リレーション取得でもクエリを1本も流さず拒否する（#234 計画レビュー）。
const mocks = vi.hoisted(() => ({
  getDatabaseEntry: vi.fn(),
}));

vi.mock("@/lib/config", () => ({ getDatabaseEntry: mocks.getDatabaseEntry }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { getDatabaseRelations } from "@/lib/introspection";
import { DatabaseNotAllowedError } from "@/lib/target-db";

describe("getDatabaseRelations の許可リスト", () => {
  beforeEach(() => {
    mocks.getDatabaseEntry.mockReset();
  });

  it("許可リストに無いDBは DatabaseNotAllowedError で拒否する", async () => {
    mocks.getDatabaseEntry.mockResolvedValue(null);
    await expect(getDatabaseRelations("app_other")).rejects.toBeInstanceOf(DatabaseNotAllowedError);
    expect(mocks.getDatabaseEntry).toHaveBeenCalledWith("app_other");
  });
});
