import { EventEmitter } from "node:events";

import type { FieldPacket } from "mysql2";
import { describe, expect, it, vi } from "vitest";

import { collectQueryResult, type QueryEmitter } from "@/lib/sql-execute";

const fields = [{ name: "id" }] as FieldPacket[];

function fakeQuery() {
  const query = new EventEmitter() as QueryEmitter;
  return {
    query,
    /** mysql2 は行を返す文でも先に fields を発行し、そのあと行ごとに result を発行する。 */
    sendRows(count: number, from = 0) {
      query.emit("fields", fields);
      for (let i = from; i < from + count; i++) query.emit("result", { id: i });
    },
  };
}

describe("collectQueryResult", () => {
  it("上限以下の件数なら全行を返し、打ち切らない", async () => {
    const { query, sendRows } = fakeQuery();
    const onTruncate = vi.fn();
    const promise = collectQueryResult(query, 3, onTruncate);
    sendRows(3);
    query.emit("end");

    await expect(promise).resolves.toEqual({
      kind: "rows",
      fields,
      rows: [{ id: 0 }, { id: 1 }, { id: 2 }],
      truncated: false,
    });
    expect(onTruncate).not.toHaveBeenCalled();
  });

  it("上限を超える行が届いたら、先頭の上限件数だけ返して打ち切る", async () => {
    const { query, sendRows } = fakeQuery();
    const onTruncate = vi.fn();
    const promise = collectQueryResult(query, 3, onTruncate);
    sendRows(4);

    await expect(promise).resolves.toEqual({
      kind: "rows",
      fields,
      rows: [{ id: 0 }, { id: 1 }, { id: 2 }],
      truncated: true,
    });
    expect(onTruncate).toHaveBeenCalledTimes(1);
  });

  it("打ち切り後に届く行・終了・エラーは結果へ影響しない", async () => {
    const { query, sendRows } = fakeQuery();
    const onTruncate = vi.fn();
    const promise = collectQueryResult(query, 2, onTruncate);
    sendRows(3);
    query.emit("result", { id: 99 });
    query.emit("error", new Error("接続を破棄した"));
    query.emit("end");

    const result = await promise;
    expect(result).toMatchObject({ kind: "rows", truncated: true });
    expect((result as { rows: unknown[] }).rows).toHaveLength(2);
    expect(onTruncate).toHaveBeenCalledTimes(1);
  });

  it("ちょうど上限件数のときは打ち切りにしない", async () => {
    const { query, sendRows } = fakeQuery();
    const promise = collectQueryResult(query, 2, vi.fn());
    sendRows(2);
    query.emit("end");

    await expect(promise).resolves.toMatchObject({ truncated: false });
  });

  it("行を返さない文は OK パケットを返す", async () => {
    const query = new EventEmitter() as QueryEmitter;
    const promise = collectQueryResult(query, 3, vi.fn());
    query.emit("fields", undefined);
    query.emit("result", { affectedRows: 5 });
    query.emit("end");

    await expect(promise).resolves.toEqual({ kind: "ok", header: { affectedRows: 5 } });
  });

  it("結果が0行でも列は返す", async () => {
    const query = new EventEmitter() as QueryEmitter;
    const promise = collectQueryResult(query, 3, vi.fn());
    query.emit("fields", fields);
    query.emit("end");

    await expect(promise).resolves.toEqual({ kind: "rows", fields, rows: [], truncated: false });
  });

  it("クエリのエラーは reject する", async () => {
    const query = new EventEmitter() as QueryEmitter;
    const promise = collectQueryResult(query, 3, vi.fn());
    query.emit("error", new Error("SELECT command denied"));

    await expect(promise).rejects.toThrow("SELECT command denied");
  });
});
