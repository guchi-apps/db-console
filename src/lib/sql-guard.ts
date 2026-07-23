import type { SqlQueryType } from "@prisma/client";

/**
 * 文字列リテラル・コメントの中身を空白に置き換える（キーワード検知・複数文検知の誤検知を減らすため）。
 * 完全なSQLパーサーではないが、キーワードマッチングの前処理として十分な安全側の近似。
 */
export function stripStringsAndComments(sql: string): string {
  let result = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];

    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      result += " ";
      i++;
      while (i < sql.length) {
        if (sql[i] === "\\" && quote !== "`") {
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "#") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    result += ch;
    i++;
  }
  return result;
}

export class MultipleStatementsError extends Error {
  constructor() {
    super("複数のSQL文は実行できません（1回につき1文のみ）");
    this.name = "MultipleStatementsError";
  }
}

export function assertSingleStatement(sql: string): void {
  const stripped = stripStringsAndComments(sql);
  const statements = stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (statements.length > 1) {
    throw new MultipleStatementsError();
  }
}

interface ForbiddenPattern {
  pattern: RegExp;
  label: string;
}

const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  { pattern: /\bGRANT\b/i, label: "GRANT" },
  { pattern: /\bREVOKE\b/i, label: "REVOKE" },
  { pattern: /\bCREATE\s+USER\b/i, label: "CREATE USER" },
  { pattern: /\bDROP\s+USER\b/i, label: "DROP USER" },
  { pattern: /\bSET\s+GLOBAL\b/i, label: "SET GLOBAL" },
  { pattern: /\bSHUTDOWN\b/i, label: "SHUTDOWN" },
  { pattern: /\bKILL\b/i, label: "KILL" },
  { pattern: /\bLOAD\s+DATA\s+LOCAL\s+INFILE\b/i, label: "LOAD DATA LOCAL INFILE" },
  { pattern: /\bINTO\s+OUTFILE\b/i, label: "INTO OUTFILE" },
  { pattern: /\bINSTALL\s+SONAME\b/i, label: "INSTALL SONAME" },
];

export class ForbiddenSqlError extends Error {
  constructor(label: string) {
    super(`禁止されているSQLです: ${label}`);
    this.name = "ForbiddenSqlError";
  }
}

export function assertNoForbiddenSql(sql: string): void {
  const stripped = stripStringsAndComments(sql);
  for (const { pattern, label } of FORBIDDEN_PATTERNS) {
    if (pattern.test(stripped)) {
      throw new ForbiddenSqlError(label);
    }
  }
}

/** DROP / TRUNCATE を含むSQLはこの画面では扱わない（テーブル構造画面の専用の再認証付きフローに誘導する）。 */
export function assertNoDropOrTruncate(sql: string): void {
  const stripped = stripStringsAndComments(sql);
  if (/\bDROP\b/i.test(stripped)) {
    throw new Error(
      "DROPを含むSQLはこの画面では実行できません。テーブル構造画面の専用機能をご利用ください。",
    );
  }
  if (/\bTRUNCATE\b/i.test(stripped)) {
    throw new Error(
      "TRUNCATEはこの画面では実行できません。テーブル構造画面の専用機能をご利用ください。",
    );
  }
}

/** 条件なしUPDATE/DELETEは原則拒否する（issue #1 のセキュリティ要件）。 */
export function assertWhereClauseForMutation(sql: string, queryType: SqlQueryType): void {
  if (queryType !== "UPDATE" && queryType !== "DELETE") return;
  const stripped = stripStringsAndComments(sql);
  if (!/\bWHERE\b/i.test(stripped)) {
    throw new Error("条件（WHERE句）のないUPDATE/DELETEは実行できません");
  }
}

export function assertSupportedQueryType(queryType: SqlQueryType): void {
  if (queryType === "OTHER") {
    throw new Error(
      "サポートされていないSQL種別です（SELECT/INSERT/UPDATE/DELETE/CREATE TABLE/ALTER TABLEのみ実行できます）",
    );
  }
}

/** SQL文の先頭キーワードから種別を判定する。 */
export function classifyStatement(sql: string): SqlQueryType {
  const stripped = stripStringsAndComments(sql).trim();
  const match = stripped.match(/^(\w+)(?:\s+(\w+))?/);
  const first = (match?.[1] ?? "").toUpperCase();
  const second = (match?.[2] ?? "").toUpperCase();

  if (first === "SELECT") return "SELECT";
  if (first === "INSERT") return "INSERT";
  if (first === "UPDATE") return "UPDATE";
  if (first === "DELETE") return "DELETE";
  if (first === "CREATE" && second === "TABLE") return "CREATE_TABLE";
  if (first === "ALTER" && second === "TABLE") return "ALTER_TABLE";
  return "OTHER";
}

/**
 * 実行前の一括安全性チェック。ここを通過したSQLのみ実行してよい。
 * 呼び出し順は重要（複数文チェック→禁止SQL→種別判定→種別許可→DROP/TRUNCATE拒否→WHERE句必須）。
 */
export function validateSqlForExecution(sql: string): SqlQueryType {
  assertSingleStatement(sql);
  assertNoForbiddenSql(sql);
  const queryType = classifyStatement(sql);
  assertSupportedQueryType(queryType);
  assertNoDropOrTruncate(sql);
  assertWhereClauseForMutation(sql, queryType);
  return queryType;
}
