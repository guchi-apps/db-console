import { describe, expect, it } from "vitest";

import { buildKeysetCondition, buildKeysetParams } from "@/lib/export";

describe("buildKeysetCondition / buildKeysetParams", () => {
  it("単一カラムの主キーは `k > ?` だけになる", () => {
    expect(buildKeysetCondition(["id"])).toBe("(`id` > ?)");
    expect(buildKeysetParams([10])).toEqual([10]);
  });

  it("複合主キーは前のカラムが等しい場合に次のカラムで比べる形へ展開する", () => {
    expect(buildKeysetCondition(["a", "b", "c"])).toBe(
      "(`a` > ?) OR (`a` = ? AND `b` > ?) OR (`a` = ? AND `b` = ? AND `c` > ?)",
    );
    expect(buildKeysetParams([1, "x", BigInt(3)])).toEqual([1, 1, "x", 1, "x", BigInt(3)]);
  });

  it("プレースホルダーの数と値の数が一致する", () => {
    const keys = ["a", "b", "c", "d"];
    const placeholders = buildKeysetCondition(keys).match(/\?/g)?.length;
    expect(buildKeysetParams(keys.map((_, i) => i))).toHaveLength(placeholders!);
  });
});
