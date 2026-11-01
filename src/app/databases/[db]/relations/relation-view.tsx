"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import {
  HEADER_HEIGHT,
  layoutRelations,
  ROW_HEIGHT,
  type LayoutNode,
  type RelationLayout,
} from "@/lib/relation-layout";
import type { DatabaseRelations, RelationEdge, RelationTable } from "@/lib/relations";

/**
 * リレーション画面の本体（#234）。図と一覧の2タブ。
 *
 * タブの既定（`auto`）は画面幅で変わる: md以上は図、それ未満は一覧。サーバーは画面幅を
 * 知らないため、stateで分けず `md:` のクラスで出し分ける（初回描画で切り替わってちらつかないように）。
 */
type Tab = "auto" | "diagram" | "list";

const MIN_SCALE = 0.25;
const MAX_SCALE = 2;
const ZOOM_STEP = 1.25;
/** これ未満の移動はドラッグではなくクリック（テーブルの選択）とみなす。 */
const CLICK_TOLERANCE = 4;

function tablePath(db: string, table: string) {
  return `/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}`;
}

function formatColumns(columns: string[]) {
  return columns.length === 1 ? columns[0] : `(${columns.join(", ")})`;
}

function formatCount(count: number | null) {
  return count === null ? "-" : count.toLocaleString("ja-JP");
}

function ViewBadge() {
  return (
    <span className="shrink-0 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-normal text-sky-700">
      ビュー
    </span>
  );
}

export function RelationView({ db, relations }: { db: string; relations: DatabaseRelations }) {
  const layout = useMemo(() => layoutRelations(relations), [relations]);
  const [tab, setTab] = useState<Tab>("auto");
  const [selected, setSelected] = useState<string | null>(null);

  if (relations.edges.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground rounded-lg border p-4 text-sm">
          このデータベースには外部キー制約が無いため、テーブル間の関係を表示できません。
          （カラム名などから関係を推測することはしていません。）
        </p>
        <IsolatedTables db={db} tables={layout.isolated} />
      </div>
    );
  }

  // `auto` のときは、md未満で一覧・md以上で図を出す。
  const diagramClass =
    tab === "diagram" ? "flex" : tab === "list" ? "hidden" : "hidden md:flex";
  const listClass = tab === "list" ? "flex" : tab === "diagram" ? "hidden" : "flex md:hidden";
  const tabButton = (value: "diagram" | "list", label: string) => {
    const on =
      tab === value
        ? "bg-background text-foreground font-semibold shadow-xs"
        : tab === "auto"
          ? value === "diagram"
            ? "text-muted-foreground md:bg-background md:text-foreground md:font-semibold md:shadow-xs"
            : "bg-background text-foreground font-semibold shadow-xs md:bg-transparent md:text-muted-foreground md:font-normal md:shadow-none"
          : "text-muted-foreground";
    return (
      <button
        type="button"
        onClick={() => setTab(value)}
        className={`rounded-md px-4 py-1 text-sm ${on}`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="bg-muted inline-flex rounded-lg border p-0.5">
          {tabButton("diagram", "図")}
          {tabButton("list", "一覧")}
        </div>
        <span className="text-muted-foreground text-xs md:text-sm">
          テーブル {relations.tables.length} ・ 外部キー {relations.edges.length}
          <span className="hidden md:inline"> ・ テーブルを押すと関係を強調</span>
        </span>
      </div>

      <div className={`${diagramClass} min-h-0 flex-1 flex-col gap-4 md:flex-row`}>
        <Diagram layout={layout} selected={selected} onSelect={setSelected} />
        <DetailPanel
          db={db}
          relations={relations}
          isolated={layout.isolated}
          selected={selected}
        />
      </div>

      <div className={`${listClass} flex-col gap-2`}>
        <RelationList db={db} layout={layout} edges={relations.edges} />
      </div>
    </div>
  );
}

function Diagram({
  layout,
  selected,
  onSelect,
}: {
  layout: RelationLayout;
  selected: string | null;
  onSelect: (name: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
    table: string | null;
  } | null>(null);

  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el || layout.width === 0) return;
    const { clientWidth: w, clientHeight: h } = el;
    if (w === 0 || h === 0) return;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(1, w / layout.width, h / layout.height)));
    setView({ scale, x: Math.max(0, (w - layout.width * scale) / 2), y: 0 });
  }, [layout]);

  // 一覧タブから切り替えた直後など、最初に大きさが付いたときに全体を収める。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let fitted = false;
    const observer = new ResizeObserver(() => {
      if (!fitted && el.clientWidth > 0 && el.clientHeight > 0) {
        fitted = true;
        fit();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  const zoom = (factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    setView((current) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor));
      const ratio = scale / current.scale;
      return { scale, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio };
    });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // キャプチャ後は event.target が容器になるため、押した箱は押した時点で控えておく。
    const target = (event.target as Element).closest("[data-table]");
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
      moved: false,
      table: target?.getAttribute("data-table") ?? null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.moved && Math.hypot(dx, dy) < CLICK_TOLERANCE) return;
    current.moved = true;
    setView((v) => ({ ...v, x: current.originX + dx, y: current.originY + dy }));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!current.moved) {
      onSelect(current.table === selected ? null : current.table);
    }
  };

  const related = useMemo(() => {
    const names = new Set<string>();
    if (!selected) return names;
    for (const { edge } of layout.edges) {
      if (edge.fromTable === selected) names.add(edge.toTable);
      if (edge.toTable === selected) names.add(edge.fromTable);
    }
    return names;
  }, [layout, selected]);

  return (
    <div
      ref={containerRef}
      className="bg-muted/30 relative h-[60dvh] min-h-80 min-w-0 flex-1 cursor-grab touch-none overflow-hidden rounded-lg border select-none active:cursor-grabbing md:h-[calc(100dvh-13rem)] md:min-h-96"
      style={{
        backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
        backgroundSize: "16px 16px",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <svg
        className="absolute top-0 left-0 overflow-visible"
        width={layout.width}
        height={layout.height}
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transformOrigin: "0 0",
        }}
        role="img"
        aria-label="テーブル間の外部キーの関係図"
      >
        {layout.edges.map((line) => {
          const active =
            selected !== null &&
            (line.edge.fromTable === selected || line.edge.toTable === selected);
          const dim = selected !== null && !active;
          const color = active ? "stroke-blue-600" : "stroke-muted-foreground";
          const d = line.startDirection;
          return (
            <g
              key={`${line.edge.fromTable}.${line.edge.constraintName}`}
              opacity={dim ? 0.25 : active ? 1 : 0.6}
            >
              <path d={line.path} fill="none" className={color} strokeWidth={active ? 2 : 1.3} />
              <circle
                cx={line.endX}
                cy={line.endY}
                r={3.5}
                className={active ? "fill-blue-600" : "fill-muted-foreground"}
              />
              <path
                d={`M${line.startX} ${line.startY - 6} L${line.startX + 8 * d} ${line.startY} L${line.startX} ${line.startY + 6}`}
                fill="none"
                className={color}
                strokeWidth={1.4}
              />
              <title>
                {`${line.edge.fromTable}.${formatColumns(line.edge.fromColumns)} → ${line.edge.toTable}.${formatColumns(line.edge.toColumns)}`}
              </title>
            </g>
          );
        })}
        {layout.nodes.map((node) => (
          <TableBox
            key={node.table.name}
            node={node}
            state={
              selected === null
                ? "normal"
                : node.table.name === selected
                  ? "selected"
                  : related.has(node.table.name)
                    ? "normal"
                    : "dim"
            }
          />
        ))}
      </svg>

      <div className="text-muted-foreground bg-background absolute bottom-2.5 left-2.5 hidden gap-3 rounded-md border px-2.5 py-1 text-[11px] sm:flex">
        <span>
          <b className="text-amber-700">PK</b> 主キー
        </span>
        <span>
          <b className="text-blue-600">FK</b> 外部キー
        </span>
        <span>● 参照される側</span>
      </div>
      <div
        className="bg-background absolute right-2.5 bottom-2.5 flex flex-col overflow-hidden rounded-md border"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="h-8 w-9 border-b hover:bg-accent" onClick={() => zoom(ZOOM_STEP)} aria-label="拡大">
          ＋
        </button>
        <button type="button" className="h-8 w-9 border-b hover:bg-accent" onClick={() => zoom(1 / ZOOM_STEP)} aria-label="縮小">
          −
        </button>
        <button type="button" className="h-8 w-9 text-[11px] hover:bg-accent" onClick={fit}>
          全体
        </button>
      </div>
    </div>
  );
}

function TableBox({ node, state }: { node: LayoutNode; state: "normal" | "selected" | "dim" }) {
  const { x, y, width, height, table } = node;
  const selected = state === "selected";
  return (
    <g data-table={table.name} opacity={state === "dim" ? 0.45 : 1} className="cursor-pointer">
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={8}
        className={selected ? "fill-background stroke-blue-600" : "fill-background stroke-border"}
        strokeWidth={selected ? 2 : 1}
      />
      <path
        d={`M${x} ${y + 8} a8 8 0 0 1 8 -8 h${width - 16} a8 8 0 0 1 8 8 v${HEADER_HEIGHT - 8} h-${width} z`}
        className={selected ? "fill-blue-50" : "fill-muted"}
      />
      <text x={x + 10} y={y + 19} fontSize={13} fontWeight={600} className="fill-foreground">
        {truncate(table.name, table.kind === "view" ? 18 : 20)}
        <title>{table.name}</title>
      </text>
      <text x={x + width - 10} y={y + 19} fontSize={10} textAnchor="end" className="fill-muted-foreground">
        {table.kind === "view" ? "ビュー" : `${formatCount(table.approximateRowCount)}件`}
      </text>
      {table.keyColumns.map((column, index) => {
        const rowY = y + HEADER_HEIGHT + ROW_HEIGHT * index;
        const label = [column.primary && "PK", column.foreign && "FK"].filter(Boolean).join(" ");
        return (
          <g key={column.name}>
            <line x1={x} x2={x + width} y1={rowY} y2={rowY} className="stroke-border" />
            <text x={x + 10} y={rowY + 15} fontSize={12} className="fill-foreground font-mono">
              {truncate(column.name, 22)}
              <title>{column.name}</title>
            </text>
            <text
              x={x + width - 10}
              y={rowY + 15}
              fontSize={9.5}
              fontWeight={600}
              textAnchor="end"
              className={column.foreign ? "fill-blue-600" : "fill-amber-700"}
            >
              {label}
            </text>
          </g>
        );
      })}
      {node.hiddenColumnCount > 0 && (
        <g>
          <line
            x1={x}
            x2={x + width}
            y1={y + HEADER_HEIGHT + ROW_HEIGHT * table.keyColumns.length}
            y2={y + HEADER_HEIGHT + ROW_HEIGHT * table.keyColumns.length}
            className="stroke-border"
          />
          <text
            x={x + 10}
            y={y + HEADER_HEIGHT + ROW_HEIGHT * table.keyColumns.length + 15}
            fontSize={11}
            className="fill-muted-foreground"
          >
            他 {node.hiddenColumnCount} カラム
          </text>
        </g>
      )}
    </g>
  );
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function DetailPanel({
  db,
  relations,
  isolated,
  selected,
}: {
  db: string;
  relations: DatabaseRelations;
  isolated: RelationTable[];
  selected: string | null;
}) {
  const outgoing = relations.edges.filter((edge) => edge.fromTable === selected);
  const incoming = relations.edges.filter((edge) => edge.toTable === selected);

  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 rounded-lg border p-4 text-sm md:max-h-[calc(100dvh-13rem)] md:w-64 md:overflow-y-auto xl:w-72">
      {selected === null ? (
        <p className="text-muted-foreground">
          図のテーブルを押すと、参照先・参照元がここに出ます。ドラッグで図を動かせます。
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <h2 className="truncate text-base font-semibold" title={selected}>
              {selected}
            </h2>
            <Link href={tablePath(db, selected)} className="shrink-0 text-xs text-blue-600 hover:underline">
              レコードを見る →
            </Link>
          </div>
          <EdgeGroup
            db={db}
            label="参照先（このテーブルが指す）"
            edges={outgoing}
            target={(edge) => edge.toTable}
            describe={(edge) =>
              `${formatColumns(edge.fromColumns)} → ${edge.toTable}.${formatColumns(edge.toColumns)}`
            }
          />
          <EdgeGroup
            db={db}
            label="参照元（このテーブルを指す）"
            edges={incoming}
            target={(edge) => edge.fromTable}
            describe={(edge) =>
              `${edge.fromTable}.${formatColumns(edge.fromColumns)} → ${formatColumns(edge.toColumns)}`
            }
          />
        </>
      )}
      {isolated.length > 0 && (
        <div className="border-t border-dashed pt-3">
          <IsolatedTables db={db} tables={isolated} compact />
        </div>
      )}
    </aside>
  );
}

function EdgeGroup({
  db,
  label,
  edges,
  target,
  describe,
}: {
  db: string;
  label: string;
  edges: RelationEdge[];
  target: (edge: RelationEdge) => string;
  describe: (edge: RelationEdge) => string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground text-xs">{label}</p>
      {edges.length === 0 && <p className="text-muted-foreground text-xs">なし</p>}
      {edges.map((edge) => (
        <Link
          key={`${edge.fromTable}.${edge.constraintName}`}
          href={tablePath(db, target(edge))}
          className="rounded-md border px-2.5 py-2 hover:bg-accent"
        >
          <span className="block truncate font-medium">{target(edge)}</span>
          <code className="text-muted-foreground block truncate text-xs" title={describe(edge)}>
            {describe(edge)}
          </code>
        </Link>
      ))}
    </div>
  );
}

function IsolatedTables({
  db,
  tables,
  compact = false,
}: {
  db: string;
  tables: RelationTable[];
  compact?: boolean;
}) {
  if (tables.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className={compact ? "text-muted-foreground text-xs" : "text-muted-foreground text-sm"}>
        関連なし（外部キーで繋がっていないテーブル・ビュー）
      </p>
      <div className="flex flex-wrap gap-1.5">
        {tables.map((table) => (
          <Link
            key={table.name}
            href={tablePath(db, table.name)}
            className="flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs hover:bg-accent"
          >
            {table.name}
            {table.kind === "view" && <ViewBadge />}
          </Link>
        ))}
      </div>
    </div>
  );
}

function RelationList({
  db,
  layout,
  edges,
}: {
  db: string;
  layout: RelationLayout;
  edges: RelationEdge[];
}) {
  const tables = layout.nodes
    .map((node) => node.table)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <ul className="flex flex-col gap-2 md:grid md:grid-cols-2 md:gap-3 xl:grid-cols-3">
        {tables.map((table) => {
          const outgoing = edges.filter((edge) => edge.fromTable === table.name);
          const incoming = edges.filter((edge) => edge.toTable === table.name);
          return (
            <li key={table.name} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={tablePath(db, table.name)}
                  className="flex min-w-0 items-center gap-2 font-semibold hover:underline"
                >
                  <span className="truncate">{table.name}</span>
                  {table.kind === "view" && <ViewBadge />}
                </Link>
                {table.kind !== "view" && (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {formatCount(table.approximateRowCount)} 件（概算）
                  </span>
                )}
              </div>
              {outgoing.map((edge) => (
                <ListRow
                  key={`out.${edge.constraintName}`}
                  direction="参照先 →"
                  db={db}
                  table={edge.toTable}
                  detail={`${formatColumns(edge.fromColumns)} → ${formatColumns(edge.toColumns)}`}
                />
              ))}
              {incoming.map((edge) => (
                <ListRow
                  key={`in.${edge.fromTable}.${edge.constraintName}`}
                  direction="← 参照元"
                  db={db}
                  table={edge.fromTable}
                  detail={formatColumns(edge.fromColumns)}
                />
              ))}
            </li>
          );
        })}
      </ul>
      <div className="mt-2">
        <IsolatedTables db={db} tables={layout.isolated} />
      </div>
    </>
  );
}

function ListRow({
  direction,
  db,
  table,
  detail,
}: {
  direction: string;
  db: string;
  table: string;
  detail: string;
}) {
  return (
    <div className="mt-1.5 flex items-baseline gap-2">
      <span className="text-muted-foreground w-14 shrink-0 text-xs">{direction}</span>
      <span className="min-w-0 truncate">
        <Link href={tablePath(db, table)} className="text-blue-600 hover:underline">
          {table}
        </Link>{" "}
        <code className="text-muted-foreground text-xs">{detail}</code>
      </span>
    </div>
  );
}
