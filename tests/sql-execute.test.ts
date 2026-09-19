import { EventEmitter } from "node:events";

import type { FieldPacket } from "mysql2";
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const release = vi.fn();
const destroy = vi.fn();
const emitterQuery = vi.fn();

vi.mock("@/lib/config", () => ({
  FORBIDDEN_DATABASE_NAMES: new Set(["mysql", "information_schema", "performance_schema", "sys"]),
}));
vi.mock("@/lib/target-db", () => ({
  getPoolForOperation: vi.fn(async () => ({
    getConnection: async () => ({
      query,
      connection: { query: emitterQuery },
      release,
      destroy,
    }),
  })),
}));

import { collectQueryResult, executeSql, type QueryEmitter } from "@/lib/sql-execute";

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

// ロールから見えるDB。app_b は許可リスト外（除外中）だが GRANT は残っている想定。
const SCHEMATA = [
  { schema_name: "information_schema" },
  { schema_name: "app_a" },
  { schema_name: "app_b" },
];

/** `connection.connection.query(sql)` が返すコールバック版クエリを模す。 */
function createRowsEmitter(rows: Record<string, unknown>[], fieldNames: string[]) {
  const emitter = new EventEmitter() as QueryEmitter;
  queueMicrotask(() => {
    emitter.emit(
      "fields",
      fieldNames.map((name) => ({ name })) as FieldPacket[],
    );
    for (const row of rows) emitter.emit("result", row);
    emitter.emit("end");
  });
  return emitter;
}

beforeEach(() => {
  query.mockReset();
  release.mockReset();
  destroy.mockReset();
  emitterQuery.mockReset();
  query.mockImplementation(async (sql: string) => {
    if (sql.includes("information_schema.schemata")) return [SCHEMATA, []];
    if (sql.startsWith("USE ")) return [{ affectedRows: 0 }, []];
    return [[], []];
  });
  emitterQuery.mockImplementation(() => createRowsEmitter([{ id: 1 }], ["id"]));
});

describe("executeSql（#134）", () => {
  it("別のDBを完全修飾名で指すSQLは、USE もSQL本体も発行せずに拒否する", async () => {
    await expect(executeSql("app_a", "SELECT * FROM app_b.users")).rejects.toThrow(/app_b/);

    const issued = query.mock.calls.map(([sql]) => sql as string);
    expect(issued).toHaveLength(1);
    expect(issued[0]).toContain("information_schema.schemata");
    expect(emitterQuery).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("DDLでも別のDBを指していれば拒否する", async () => {
    await expect(executeSql("app_a", "ALTER TABLE app_b.t ADD COLUMN c INT")).rejects.toThrow(
      /app_b/,
    );
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("USE "))).toBe(false);
    expect(emitterQuery).not.toHaveBeenCalled();
  });

  it("開いているDBだけを指すSQLは、これまでどおり USE してから実行する", async () => {
    const result = await executeSql("app_a", "SELECT * FROM app_a.users");

    const issued = query.mock.calls.map(([sql]) => sql as string);
    expect(issued[1]).toBe("USE `app_a`");
    expect(emitterQuery).toHaveBeenCalledWith("SELECT * FROM app_a.users");
    expect(result.rows).toEqual([{ id: 1 }]);
    expect(release).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("information_schema の参照は引き続き通す", async () => {
    await expect(
      executeSql("app_a", "SELECT * FROM information_schema.tables"),
    ).resolves.toBeDefined();
  });
});
