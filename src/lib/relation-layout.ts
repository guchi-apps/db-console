import type { DatabaseRelations, RelationEdge, RelationTable } from "@/lib/relations";

/**
 * リレーション図の配置（#234）。描画ライブラリを使わず、ここで決めた座標をSVGへそのまま渡す。
 *
 * - 参照される側（親）を左、参照する側（子）を右の段に置く。段 = 親の段の最大 + 1
 * - 循環参照は、探索中のテーブルへ戻る辺を段の計算から外して打ち切る
 * - 外部キーで誰とも繋がらないテーブル・ビューは図に入れず `isolated` へ回す
 */

export const BOX_WIDTH = 200;
export const HEADER_HEIGHT = 30;
export const ROW_HEIGHT = 22;
const COLUMN_GAP = 90;
const ROW_GAP = 28;
const PADDING = 24;
/** 同じ側（右端どうし）で結ぶ線のふくらみ。自己参照・同じ段・右向きの参照で使う。 */
const LOOP_OFFSET = 36;

export interface LayoutNode {
  table: RelationTable;
  level: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 「他 N カラム」の行を出すときの N（0なら行を出さない）。 */
  hiddenColumnCount: number;
}

export interface LayoutEdge {
  edge: RelationEdge;
  /** SVG の path の d 属性。 */
  path: string;
  /** 参照される側の端（丸印を置く位置）。 */
  endX: number;
  endY: number;
  /** 参照する側の端と、矢じりの向き（左向きに入るなら -1、右から入るなら 1）。 */
  startX: number;
  startY: number;
  startDirection: -1 | 1;
}

export interface RelationLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  /** 外部キーで繋がりのないテーブル・ビュー（名前順）。 */
  isolated: RelationTable[];
}

/** 各テーブルの段を決める。親（参照先）を持たないテーブルが0。 */
export function computeLevels(
  tableNames: string[],
  edges: RelationEdge[],
): Map<string, number> {
  const parents = new Map<string, string[]>();
  for (const name of tableNames) parents.set(name, []);
  for (const edge of edges) {
    if (edge.fromTable === edge.toTable) continue; // 自己参照は段に影響させない
    parents.get(edge.fromTable)?.push(edge.toTable);
  }

  const levels = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (name: string): number => {
    const done = levels.get(name);
    if (done !== undefined) return done;
    if (visiting.has(name)) return -1; // 循環: この辺は段の計算に使わない
    visiting.add(name);
    let level = 0;
    for (const parent of parents.get(name) ?? []) {
      const parentLevel = visit(parent);
      if (parentLevel >= 0) level = Math.max(level, parentLevel + 1);
    }
    visiting.delete(name);
    levels.set(name, level);
    return level;
  };
  for (const name of tableNames) visit(name);
  return levels;
}

function nodeHeight(table: RelationTable): { height: number; hidden: number } {
  const hidden = Math.max(0, table.columnCount - table.keyColumns.length);
  const rows = table.keyColumns.length + (hidden > 0 ? 1 : 0);
  return { height: HEADER_HEIGHT + ROW_HEIGHT * Math.max(rows, 1), hidden };
}

/** カラム行の縦の中心。見つからなければ見出し行の中心。 */
function columnCenterY(node: LayoutNode, column: string | undefined): number {
  const index = column === undefined
    ? -1
    : node.table.keyColumns.findIndex((key) => key.name === column);
  if (index < 0) return node.y + HEADER_HEIGHT / 2;
  return node.y + HEADER_HEIGHT + ROW_HEIGHT * index + ROW_HEIGHT / 2;
}

export function layoutRelations(relations: DatabaseRelations): RelationLayout {
  const connected = new Set<string>();
  for (const edge of relations.edges) {
    connected.add(edge.fromTable);
    connected.add(edge.toTable);
  }
  const sortedTables = [...relations.tables].sort((a, b) => a.name.localeCompare(b.name));
  const diagramTables = sortedTables.filter((table) => connected.has(table.name));
  const isolated = sortedTables.filter((table) => !connected.has(table.name));

  const levels = computeLevels(
    diagramTables.map((table) => table.name),
    relations.edges,
  );

  const byLevel = new Map<number, RelationTable[]>();
  for (const table of diagramTables) {
    const level = levels.get(table.name) ?? 0;
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level)!.push(table);
  }

  // 段の中の並びは、親の並び順の平均（重心）に寄せて線の交差を減らす。
  const orderIndex = new Map<string, number>();
  const parentsOf = (name: string) =>
    relations.edges
      .filter((edge) => edge.fromTable === name && edge.toTable !== name)
      .map((edge) => edge.toTable);
  const levelNumbers = [...byLevel.keys()].sort((a, b) => a - b);
  for (const level of levelNumbers) {
    const tables = byLevel.get(level)!;
    const weight = (table: RelationTable, fallback: number) => {
      const indices = parentsOf(table.name)
        .map((parent) => orderIndex.get(parent))
        .filter((value): value is number => value !== undefined);
      return indices.length === 0
        ? fallback
        : indices.reduce((sum, value) => sum + value, 0) / indices.length;
    };
    const weighted = tables.map((table, index) => ({ table, w: weight(table, index) }));
    weighted.sort((a, b) => a.w - b.w || a.table.name.localeCompare(b.table.name));
    weighted.forEach(({ table }, index) => orderIndex.set(table.name, index));
    byLevel.set(level, weighted.map(({ table }) => table));
  }

  const nodes: LayoutNode[] = [];
  const nodeByName = new Map<string, LayoutNode>();
  let height = 0;
  levelNumbers.forEach((level, column) => {
    let y = PADDING;
    for (const table of byLevel.get(level)!) {
      const { height: h, hidden } = nodeHeight(table);
      const node: LayoutNode = {
        table,
        level,
        x: PADDING + column * (BOX_WIDTH + COLUMN_GAP),
        y,
        width: BOX_WIDTH,
        height: h,
        hiddenColumnCount: hidden,
      };
      nodes.push(node);
      nodeByName.set(table.name, node);
      y += h + ROW_GAP;
    }
    height = Math.max(height, y - ROW_GAP + PADDING);
  });

  const edges: LayoutEdge[] = [];
  for (const edge of relations.edges) {
    const from = nodeByName.get(edge.fromTable);
    const to = nodeByName.get(edge.toTable);
    if (!from || !to) continue;
    const startY = columnCenterY(from, edge.fromColumns[0]);
    const endY = columnCenterY(to, edge.toColumns[0]);
    const endX = to.x + to.width;
    if (endX < from.x) {
      // 通常: 親は左の段にある。子の左端から親の右端へ。
      const startX = from.x;
      const mid = (startX + endX) / 2;
      edges.push({
        edge,
        path: `M${startX} ${startY} C${mid} ${startY},${mid} ${endY},${endX} ${endY}`,
        startX,
        startY,
        endX,
        endY,
        startDirection: -1,
      });
    } else {
      // 自己参照・循環で同じ段以降にある親: 右端どうしを外側へふくらませて結ぶ。
      const startX = from.x + from.width;
      const bulge = Math.max(startX, endX) + LOOP_OFFSET;
      edges.push({
        edge,
        path: `M${startX} ${startY} C${bulge} ${startY},${bulge} ${endY},${endX} ${endY}`,
        startX,
        startY,
        endX,
        endY,
        startDirection: 1,
      });
    }
  }

  const width =
    levelNumbers.length === 0
      ? 0
      : PADDING * 2 + levelNumbers.length * BOX_WIDTH + (levelNumbers.length - 1) * COLUMN_GAP + LOOP_OFFSET;

  return { nodes, edges, width, height, isolated };
}
