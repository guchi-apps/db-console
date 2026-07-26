import { escape as sqlEscape } from "mysql2";

// DDLの型定義部分はプレースホルダーが使えないため、自由入力のSQL文字列は一切受け付けず、
// この許可リストのテンプレートからのみカラム型を組み立てる。

export interface ColumnTypeTemplate {
  key: string;
  label: string;
  /** param1 / param2 の入力欄に表示するヒント。undefinedならその欄は使わない。 */
  param1Hint?: string;
  param2Hint?: string;
  build: (param1: string, param2: string) => string;
}

function parsePositiveInt(raw: string, label: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${label}には正の整数を指定してください`);
  }
  return n;
}

function escapeEnumValues(raw: string): string {
  const values = raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  if (values.length === 0) {
    throw new Error("ENUMの値をカンマ区切りで1つ以上指定してください");
  }
  return values.map((v) => sqlEscape(v)).join(",");
}

export const COLUMN_TYPE_TEMPLATES: ColumnTypeTemplate[] = [
  {
    key: "VARCHAR",
    label: "文字列（可変長）",
    param1Hint: "最大文字数（例: 191）",
    build: (p1) => `VARCHAR(${parsePositiveInt(p1, "最大文字数")})`,
  },
  { key: "TEXT", label: "長文テキスト", build: () => "TEXT" },
  { key: "INT", label: "整数", build: () => "INT" },
  { key: "BIGINT", label: "整数（大）", build: () => "BIGINT" },
  {
    key: "DECIMAL",
    label: "小数",
    param1Hint: "全体の桁数（例: 10）",
    param2Hint: "小数点以下の桁数（例: 2）",
    build: (p1, p2) => {
      const precision = parsePositiveInt(p1, "全体の桁数");
      const scale = Number(p2 || "0");
      if (!Number.isInteger(scale) || scale < 0 || scale > precision) {
        throw new Error("小数点以下の桁数が不正です");
      }
      return `DECIMAL(${precision},${scale})`;
    },
  },
  { key: "BOOLEAN", label: "真偽値", build: () => "TINYINT(1)" },
  { key: "DATE", label: "日付", build: () => "DATE" },
  { key: "DATETIME", label: "日時", build: () => "DATETIME" },
  {
    key: "ENUM",
    label: "選択肢（ENUM）",
    param1Hint: "カンマ区切りの値（例: A,B,C）",
    build: (p1) => `ENUM(${escapeEnumValues(p1)})`,
  },
];

export interface ColumnTypeOption {
  key: string;
  label: string;
  param1Hint?: string;
  param2Hint?: string;
}

/** Client Componentへ渡すためのシリアライズ可能な部分（build関数を除いたもの）。 */
export const COLUMN_TYPE_OPTIONS: ColumnTypeOption[] = COLUMN_TYPE_TEMPLATES.map(
  ({ key, label, param1Hint, param2Hint }) => ({ key, label, param1Hint, param2Hint }),
);

export function getColumnTypeTemplate(key: string): ColumnTypeTemplate {
  const template = COLUMN_TYPE_TEMPLATES.find((t) => t.key === key);
  if (!template) {
    throw new Error(`不明な型です: ${key}`);
  }
  return template;
}

/** フォーム入力（型キー + param1/param2）から安全なSQL型文字列を組み立てる。 */
export function buildSqlType(typeKey: string, param1: string, param2: string): string {
  return getColumnTypeTemplate(typeKey).build(param1, param2);
}
