import { describe, expect, it } from "vitest";

import type { TableSummary } from "@/lib/introspection";
import { computeLevels, layoutRelations } from "@/lib/relation-layout";
import { buildDatabaseRelations, type RelationEdge } from "@/lib/relations";

const table = (name: string, kind: "table" | "view" = "table"): TableSummary => ({
  name,
  kind,
  engine: kind === "view" ? null : "InnoDB",
  approximateRowCount: kind === "view" ? null : 10,
  comment: null,
});

const edge = (fromTable: string, toTable: string, from = `${toTable}_id`, to = "id"): RelationEdge => ({
  constraintName: `fk_${fromTable}_${from}`,
  fromTable,
  fromColumns: [from],
  toTable,
  toColumns: [to],
});

describe("buildDatabaseRelations", () => {
  it("複合外部キーを制約名でまとめ、主キー・外部キーのカラムだけを箱に出す", () => {
    const relations = buildDatabaseRelations(
      [table("orders"), table("order_items"), table("v_summary", "view")],
      [
        { tableName: "orders", columnName: "shop_id", columnKey: "PRI" },
        { tableName: "orders", columnName: "no", columnKey: "PRI" },
        { tableName: "orders", columnName: "note", columnKey: "" },
        { tableName: "order_items", columnName: "id", columnKey: "PRI" },
        { tableName: "order_items", columnName: "order_shop_id", columnKey: "MUL" },
        { tableName: "order_items", columnName: "order_no", columnKey: "" },
        { tableName: "order_items", columnName: "qty", columnKey: "" },
        { tableName: "v_summary", columnName: "total", columnKey: "" },
      ],
      [
        { constraintName: "fk_order", tableName: "order_items", columnName: "order_shop_id", referencedTable: "orders", referencedColumn: "shop_id" },
        { constraintName: "fk_order", tableName: "order_items", columnName: "order_no", referencedTable: "orders", referencedColumn: "no" },
      ],
    );

    expect(relations.edges).toEqual([
      {
        constraintName: "fk_order",
        fromTable: "order_items",
        fromColumns: ["order_shop_id", "order_no"],
        toTable: "orders",
        toColumns: ["shop_id", "no"],
      },
    ]);
    const items = relations.tables.find((t) => t.name === "order_items")!;
    expect(items.keyColumns.map((c) => c.name)).toEqual(["id", "order_shop_id", "order_no"]);
    expect(items.columnCount).toBe(4);
    const view = relations.tables.find((t) => t.name === "v_summary")!;
    expect(view.keyColumns).toEqual([]);
    expect(view.kind).toBe("view");
  });

  it("一覧に無いテーブルを指す外部キーは捨てる", () => {
    const relations = buildDatabaseRelations(
      [table("a")],
      [],
      [{ constraintName: "fk", tableName: "a", columnName: "x", referencedTable: "missing", referencedColumn: "id" }],
    );
    expect(relations.edges).toEqual([]);
  });
});

describe("computeLevels", () => {
  it("参照される側が左（段0）、参照する側は親の段の最大 + 1", () => {
    const levels = computeLevels(
      ["users", "cars", "records", "shops", "items"],
      [edge("cars", "users"), edge("records", "cars"), edge("records", "shops"), edge("items", "records")],
    );
    expect(Object.fromEntries(levels)).toEqual({ users: 0, shops: 0, cars: 1, records: 2, items: 3 });
  });

  it("循環参照・自己参照でも止まる", () => {
    const levels = computeLevels(
      ["a", "b", "c"],
      [edge("a", "b"), edge("b", "a"), edge("c", "c", "parent_id")],
    );
    expect(levels.size).toBe(3);
    expect(levels.get("c")).toBe(0);
    expect([levels.get("a"), levels.get("b")].sort()).toEqual([0, 1]);
  });
});

describe("layoutRelations", () => {
  const relations = buildDatabaseRelations(
    [table("users"), table("cars"), table("settings"), table("v_cost", "view"), table("categories")],
    [
      { tableName: "users", columnName: "id", columnKey: "PRI" },
      { tableName: "cars", columnName: "id", columnKey: "PRI" },
      { tableName: "cars", columnName: "user_id", columnKey: "MUL" },
      { tableName: "cars", columnName: "model", columnKey: "" },
      { tableName: "categories", columnName: "id", columnKey: "PRI" },
      { tableName: "categories", columnName: "parent_id", columnKey: "MUL" },
    ],
    [
      { constraintName: "fk_user", tableName: "cars", columnName: "user_id", referencedTable: "users", referencedColumn: "id" },
      { constraintName: "fk_parent", tableName: "categories", columnName: "parent_id", referencedTable: "categories", referencedColumn: "id" },
    ],
  );
  const layout = layoutRelations(relations);

  it("繋がりの無いテーブル・ビューは図に入れず isolated へ回す", () => {
    expect(layout.isolated.map((t) => t.name)).toEqual(["settings", "v_cost"]);
    expect(layout.nodes.map((n) => n.table.name).sort()).toEqual(["cars", "categories", "users"]);
  });

  it("親は子より左に置き、線は子の左端から親の右端へ引く", () => {
    const users = layout.nodes.find((n) => n.table.name === "users")!;
    const cars = layout.nodes.find((n) => n.table.name === "cars")!;
    expect(users.x).toBeLessThan(cars.x);
    expect(cars.hiddenColumnCount).toBe(1);
    const line = layout.edges.find((e) => e.edge.fromTable === "cars")!;
    expect(line.startX).toBe(cars.x);
    expect(line.endX).toBe(users.x + users.width);
    expect(line.startDirection).toBe(-1);
  });

  it("自己参照は右端どうしを結ぶ", () => {
    const categories = layout.nodes.find((n) => n.table.name === "categories")!;
    const loop = layout.edges.find((e) => e.edge.fromTable === "categories")!;
    expect(loop.startX).toBe(categories.x + categories.width);
    expect(loop.endX).toBe(categories.x + categories.width);
    expect(loop.startY).not.toBe(loop.endY);
    expect(loop.startDirection).toBe(1);
  });

  it("図全体の大きさが全ての箱を含む", () => {
    for (const node of layout.nodes) {
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
      expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
    }
  });

  it("外部キーが1つも無ければ図は空", () => {
    const empty = layoutRelations({ tables: relations.tables, edges: [] });
    expect(empty.nodes).toEqual([]);
    expect(empty.width).toBe(0);
    expect(empty.isolated).toHaveLength(5);
  });
});
