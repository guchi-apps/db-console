import { escape as sqlEscape } from "mysql2";

import { parseColumnDefault, type ColumnDefaultMode } from "@/lib/column-default";
import { quoteColumn } from "@/lib/identifier";

/**
 * MODIFY COLUMN の組み立て（#132）。
 *
 * MODIFY COLUMN はカラム定義を丸ごと置き換えるため、フォームで扱わない属性
 * （AUTO_INCREMENT・ON UPDATE・INVISIBLE・カラム単位の文字セット/照合順序）は
 * 現在の定義から引き継いで書き直す。書き漏らすと黙って外れる
 * （主キーの AUTO_INCREMENT が外れると、そのテーブルを使うアプリのINSERTが失敗する）。
 * 引き継ぎ方の分からない属性（生成列など）があるときは、壊すより拒否する。
 */

/** MODIFY で引き継ぐ、現在のカラムの定義。 */
export interface CurrentColumnDefinition {
  name: string;
  columnType: string;
  columnDefault: string | null;
  extra: string;
  characterSetName: string | null;
  collationName: string | null;
}

export type ColumnDefaultInput =
  | { mode: Exclude<ColumnDefaultMode, "value"> }
  | { mode: "value"; value: string };

export interface ColumnModificationSqlInput {
  /** 新しい型。null は「現在の型のまま」（現在の column_type をそのまま使う）。 */
  sqlType: string | null;
  nullable: boolean;
  default: ColumnDefaultInput;
  comment?: string;
  position?: "first" | { after: string };
}

export class UnsupportedColumnAttributeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedColumnAttributeError";
  }
}

const CHARACTER_TYPE = /^\s*(?:national\s+)?(?:var)?char\b|^\s*n(?:var)?char\b|^\s*(?:tiny|medium|long)?text\b|^\s*enum\s*\(|^\s*set\s*\(/i;
const CHARSET_NAME = /^[A-Za-z0-9_]+$/;
const ON_UPDATE = /on update (current_timestamp(?:\(\s*\d?\s*\))?)/i;
const FRACTIONAL_TEMPORAL = /^\s*(?:datetime|timestamp)\s*\(\s*(\d)\s*\)/i;

/** extra の値を、MODIFY 文で書き直す句へ変換する。扱えない属性があれば例外。 */
function carryOverExtra(current: CurrentColumnDefinition): string {
  let rest = current.extra.trim();
  const clauses: string[] = [];

  if (/\bauto_increment\b/i.test(rest)) {
    clauses.push("AUTO_INCREMENT");
    rest = rest.replace(/\bauto_increment\b/i, "");
  }
  const onUpdate = ON_UPDATE.exec(rest);
  if (onUpdate) {
    const precision = /\((\d)\)/.exec(onUpdate[1])?.[1];
    clauses.push(`ON UPDATE CURRENT_TIMESTAMP${precision ? `(${precision})` : ""}`);
    rest = rest.replace(ON_UPDATE, "");
  }
  if (/\binvisible\b/i.test(rest)) {
    clauses.push("INVISIBLE");
    rest = rest.replace(/\binvisible\b/i, "");
  }

  if (/\bgenerated\b/i.test(rest)) {
    throw new UnsupportedColumnAttributeError(
      `${current.name} は生成列のため、この画面では変更できません（生成式が失われるため）`,
    );
  }
  if (rest.trim() !== "") {
    throw new UnsupportedColumnAttributeError(
      `${current.name} には引き継げない属性（${current.extra}）があるため、この画面では変更できません`,
    );
  }
  return clauses.map((c) => ` ${c}`).join("");
}

/** 文字列型へ変える（または文字列型のまま）ときだけ、現在の文字セット・照合順序を引き継ぐ。 */
function carryOverCharset(current: CurrentColumnDefinition, sqlType: string): string {
  if (!CHARACTER_TYPE.test(sqlType)) return "";
  let sql = "";
  if (current.characterSetName && CHARSET_NAME.test(current.characterSetName)) {
    sql += ` CHARACTER SET ${current.characterSetName}`;
  }
  if (current.collationName && CHARSET_NAME.test(current.collationName)) {
    sql += ` COLLATE ${current.collationName}`;
  }
  return sql;
}

function currentTimestampFor(sqlType: string): string {
  const precision = FRACTIONAL_TEMPORAL.exec(sqlType)?.[1];
  return precision ? `CURRENT_TIMESTAMP(${precision})` : "CURRENT_TIMESTAMP";
}

/** DEFAULT 句を組み立てる。`column_default` の値をそのままエスケープして送り返さない。 */
function buildDefaultClause(
  current: CurrentColumnDefinition,
  input: ColumnDefaultInput,
  sqlType: string,
  nullable: boolean,
): string {
  switch (input.mode) {
    case "none":
      return "";
    case "null":
      return " DEFAULT NULL";
    case "value":
      return ` DEFAULT ${sqlEscape(input.value)}`;
    case "current_timestamp":
      return ` DEFAULT ${currentTimestampFor(sqlType)}`;
    case "keep": {
      const parsed = parseColumnDefault(current.columnDefault);
      switch (parsed.kind) {
        case "none":
          return "";
        case "null":
          // NOT NULL へ変えるときは NULL をデフォルトに持てない（「デフォルトなし」になる）。
          return nullable ? " DEFAULT NULL" : "";
        case "literal":
        case "current_timestamp":
          return ` DEFAULT ${parsed.sql}`;
        case "expression":
          throw new UnsupportedColumnAttributeError(
            `${current.name} のデフォルト値（${parsed.sql}）は引き継げません。デフォルト値を指定し直してください`,
          );
      }
    }
  }
}

/**
 * `ALTER TABLE ... MODIFY COLUMN ...` の文を組み立てる。
 * qualifiedTable・position.after は呼び出し側で実在確認・エスケープ済みのものを渡すこと。
 */
export function buildModifyColumnSql(
  qualifiedTable: string,
  current: CurrentColumnDefinition,
  input: ColumnModificationSqlInput,
): string {
  const sqlType = input.sqlType ?? current.columnType;
  const nullSql = input.nullable ? "NULL" : "NOT NULL";

  let sql = `ALTER TABLE ${qualifiedTable} MODIFY COLUMN ${quoteColumn(current.name)} ${sqlType}`;
  sql += carryOverCharset(current, sqlType);
  sql += ` ${nullSql}`;
  sql += buildDefaultClause(current, input.default, sqlType, input.nullable);
  sql += carryOverExtra(current);
  if (input.comment) {
    sql += ` COMMENT ${sqlEscape(input.comment)}`;
  }
  if (input.position === "first") {
    sql += " FIRST";
  } else if (input.position) {
    sql += ` AFTER ${quoteColumn(input.position.after)}`;
  }
  return sql;
}
