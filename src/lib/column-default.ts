/**
 * カラムのデフォルト値の扱い（#132）。画面（クライアント）とサーバーの両方から使うため、
 * DB接続やmysql2に依存しない純粋な関数だけを置く。
 *
 * MariaDB（10.2.7以降）の `information_schema.columns.column_default` は次の形で返る。
 * - デフォルトなし: SQLの NULL
 * - NULLがデフォルト: 文字列 `NULL`
 * - 文字列リテラル: 引用符付き（`'abc'`、中の `'` は `''`）
 * - 数値: そのまま（`0`・`-1.5`）
 * - 式: そのまま（`current_timestamp()`・`uuid()` など）
 *
 * この値をそのまま `sqlEscape()` へ通して送り返すと `'''abc'''`・文字列の `'NULL'` に化けるため、
 * 必ずここで解釈してから扱う。
 */

/** `column_default` を解釈した結果。 */
export type ParsedColumnDefault =
  | { kind: "none" }
  | { kind: "null" }
  | { kind: "literal"; value: string; sql: string }
  | { kind: "current_timestamp"; sql: string }
  | { kind: "expression"; sql: string };

/** カラム変更フォームで選ぶデフォルト値の指定方法。 */
export type ColumnDefaultMode = "keep" | "value" | "null" | "current_timestamp" | "none";

export const COLUMN_DEFAULT_MODES: readonly ColumnDefaultMode[] = [
  "keep",
  "value",
  "null",
  "current_timestamp",
  "none",
];

export function isColumnDefaultMode(value: string): value is ColumnDefaultMode {
  return (COLUMN_DEFAULT_MODES as readonly string[]).includes(value);
}

const QUOTED_LITERAL = /^'((?:[^'\\]|''|\\[\s\S])*)'$/;
const NUMERIC_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const BIT_LITERAL = /^b'[01]*'$/i;
const CURRENT_TIMESTAMP = /^current_timestamp(?:\(\s*(\d)?\s*\))?$/i;

/** `'it''s'` → `it's`（MariaDBが返す引用符付きリテラルの中身を取り出す）。 */
function unquoteLiteral(body: string): string {
  // `''` と `\x` は1回の走査で置き換える（順に置き換えると `\''` のような並びを取り違える）。
  return body.replace(/''|\\([\s\S])/g, (match, ch: string | undefined) => {
    if (ch === undefined) return "'";
    switch (ch) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "0":
        return "\0";
      case "Z":
        return "\x1a";
      default:
        return ch;
    }
  });
}

/** `information_schema.columns.column_default` を解釈する。 */
export function parseColumnDefault(raw: string | null): ParsedColumnDefault {
  if (raw === null) return { kind: "none" };
  const text = raw.trim();
  if (text.toUpperCase() === "NULL") return { kind: "null" };

  const quoted = QUOTED_LITERAL.exec(text);
  if (quoted) return { kind: "literal", value: unquoteLiteral(quoted[1]), sql: text };
  if (NUMERIC_LITERAL.test(text)) return { kind: "literal", value: text, sql: text };
  if (BIT_LITERAL.test(text)) return { kind: "literal", value: text, sql: text };

  const timestamp = CURRENT_TIMESTAMP.exec(text);
  if (timestamp) {
    const precision = timestamp[1];
    return {
      kind: "current_timestamp",
      sql: precision ? `CURRENT_TIMESTAMP(${precision})` : "CURRENT_TIMESTAMP",
    };
  }
  return { kind: "expression", sql: text };
}

/** 画面に出す現在のデフォルト値の説明。 */
export function describeColumnDefault(parsed: ParsedColumnDefault): string {
  switch (parsed.kind) {
    case "none":
      return "なし";
    case "null":
      return "NULL";
    case "literal":
      return parsed.value;
    case "current_timestamp":
    case "expression":
      return parsed.sql;
  }
}
