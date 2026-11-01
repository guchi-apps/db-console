import type { TableKind, TableSummary } from "@/lib/introspection";

/** リレーション画面の箱に出すカラム（主キー・外部キーのどちらかに当たるものだけ）。 */
export interface RelationKeyColumn {
  name: string;
  primary: boolean;
  foreign: boolean;
}

export interface RelationTable {
  name: string;
  kind: TableKind;
  approximateRowCount: number | null;
  /** 主キー・外部キーのカラム（ordinal_position 順）。 */
  keyColumns: RelationKeyColumn[];
  /** 全カラム数（箱に「他 N カラム」と出すため）。 */
  columnCount: number;
}

/** 外部キー制約1つ。複合外部キーは制約名でまとめ、カラムの並びは制約内の順序に揃える。 */
export interface RelationEdge {
  constraintName: string;
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
}

export interface DatabaseRelations {
  tables: RelationTable[];
  edges: RelationEdge[];
}

/** `getDatabaseRelations()` の組み立て部分。DBを介さずテストできるよう分けている。 */
export function buildDatabaseRelations(
  tables: TableSummary[],
  columns: { tableName: string; columnName: string; columnKey: string }[],
  foreignKeyColumns: {
    constraintName: string;
    tableName: string;
    columnName: string;
    referencedTable: string;
    referencedColumn: string;
  }[],
): DatabaseRelations {
  const known = new Set(tables.map((table) => table.name));

  const edgesByKey = new Map<string, RelationEdge>();
  const foreignColumns = new Set<string>();
  for (const fk of foreignKeyColumns) {
    if (!known.has(fk.tableName) || !known.has(fk.referencedTable)) continue;
    const key = `${fk.tableName}\u0000${fk.constraintName}`;
    let edge = edgesByKey.get(key);
    if (!edge) {
      edge = {
        constraintName: fk.constraintName,
        fromTable: fk.tableName,
        fromColumns: [],
        toTable: fk.referencedTable,
        toColumns: [],
      };
      edgesByKey.set(key, edge);
    }
    edge.fromColumns.push(fk.columnName);
    edge.toColumns.push(fk.referencedColumn);
    foreignColumns.add(`${fk.tableName}\u0000${fk.columnName}`);
  }

  const columnsByTable = new Map<string, { keys: RelationKeyColumn[]; count: number }>();
  for (const column of columns) {
    if (!known.has(column.tableName)) continue;
    let entry = columnsByTable.get(column.tableName);
    if (!entry) {
      entry = { keys: [], count: 0 };
      columnsByTable.set(column.tableName, entry);
    }
    entry.count += 1;
    const primary = column.columnKey.toUpperCase() === "PRI";
    const foreign = foreignColumns.has(`${column.tableName}\u0000${column.columnName}`);
    if (primary || foreign) {
      entry.keys.push({ name: column.columnName, primary, foreign });
    }
  }

  return {
    tables: tables.map((table) => {
      const entry = columnsByTable.get(table.name);
      return {
        name: table.name,
        kind: table.kind,
        approximateRowCount: table.approximateRowCount,
        keyColumns: entry?.keys ?? [],
        columnCount: entry?.count ?? 0,
      };
    }),
    edges: Array.from(edgesByKey.values()),
  };
}
