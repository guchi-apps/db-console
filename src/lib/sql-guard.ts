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
      "サポートされていないSQL種別です（SELECT/INSERT/UPDATE/DELETE/CREATE TABLE/ALTER TABLE、およびSHOW/DESCRIBE/EXPLAINの読み取り専用SQLのみ実行できます）",
    );
  }
}

/**
 * SHOW のうち、対象DB・テーブルの情報だけを返す文の2語目（許可リスト）。
 * ここに無い SHOW はすべて OTHER として拒否する。SHOW GRANTS / PROCESSLIST / VARIABLES /
 * STATUS / ENGINES / DATABASES のような「サーバー全体の情報」を通さないため、
 * 拒否リストではなく許可リストで持つ（issue #85）。
 */
const READ_ONLY_SHOW_KEYWORDS = new Set([
  "CREATE", // SHOW CREATE TABLE / VIEW / DATABASE / TRIGGER など（SHOW CREATE USER は FORBIDDEN_PATTERNS が先に弾く）
  "COLUMNS",
  "FIELDS",
  "INDEX",
  "INDEXES",
  "KEYS",
  "TABLE", // SHOW TABLE STATUS
  "TABLES",
  "TRIGGERS",
]);

/** SHOW FULL に続けてよい3語目。SHOW FULL PROCESSLIST を通さないため別に持つ。 */
const READ_ONLY_SHOW_FULL_KEYWORDS = new Set(["COLUMNS", "FIELDS", "TABLES"]);

/**
 * EXPLAIN / DESCRIBE の直後に来てはいけない語。MariaDBの ANALYZE 系（`EXPLAIN ANALYZE` /
 * `ANALYZE UPDATE`）は対象の文を実際に実行するため読み取り専用とみなせず、
 * EXPLAIN FOR CONNECTION は他セッションを覗くサーバー全体の情報を返す。
 */
const NON_READ_ONLY_EXPLAIN_KEYWORDS = new Set([
  "ANALYZE",
  "FOR",
  "INSERT",
  "UPDATE",
  "DELETE",
  "REPLACE",
]);

/** SQL文の先頭キーワードから種別を判定する。 */
export function classifyStatement(sql: string): SqlQueryType {
  const stripped = stripStringsAndComments(sql).trim();
  const match = stripped.match(/^(\w+)(?:\s+(\w+))?(?:\s+(\w+))?/);
  const first = (match?.[1] ?? "").toUpperCase();
  const second = (match?.[2] ?? "").toUpperCase();
  const third = (match?.[3] ?? "").toUpperCase();

  if (first === "SELECT") return "SELECT";
  if (first === "INSERT") return "INSERT";
  if (first === "UPDATE") return "UPDATE";
  if (first === "DELETE") return "DELETE";
  if (first === "CREATE" && second === "TABLE") return "CREATE_TABLE";
  if (first === "ALTER" && second === "TABLE") return "ALTER_TABLE";
  if (first === "SHOW") {
    if (second === "FULL") {
      return READ_ONLY_SHOW_FULL_KEYWORDS.has(third) ? "SHOW" : "OTHER";
    }
    return READ_ONLY_SHOW_KEYWORDS.has(second) ? "SHOW" : "OTHER";
  }
  if (first === "DESCRIBE" || first === "DESC") {
    return NON_READ_ONLY_EXPLAIN_KEYWORDS.has(second) ? "OTHER" : "DESCRIBE";
  }
  if (first === "EXPLAIN") {
    return NON_READ_ONLY_EXPLAIN_KEYWORDS.has(second) ? "OTHER" : "EXPLAIN";
  }
  return "OTHER";
}

/**
 * 実行前の一括安全性チェック。ここを通過したSQLのみ実行してよい。
 * 呼び出し順は重要（複数文チェック→禁止SQL→種別判定→種別許可→DROP/TRUNCATE拒否→WHERE句必須）。
 */
/**
 * テーブル構造（DDL）を変えるSQLの種別（#105）。実行前に確認ダイアログと再認証を求める。
 * SELECT・INSERT・UPDATE・DELETE と読み取り専用のSHOW/DESCRIBE/EXPLAINは従来どおり素通し。
 */
const SCHEMA_CHANGE_QUERY_TYPES: ReadonlySet<SqlQueryType> = new Set<SqlQueryType>([
  "CREATE_TABLE",
  "ALTER_TABLE",
]);

export function isSchemaChangeQueryType(queryType: SqlQueryType): boolean {
  return SCHEMA_CHANGE_QUERY_TYPES.has(queryType);
}

/**
 * 入力中のSQLが構造を変えるものかどうか。判定は先頭キーワードだけを見る classifyStatement に
 * 委ねてあるため、ブラウザ側（SQL実行フォーム）からも同じ関数で判定できる。
 * 実行可否そのものは validateSqlForExecution が別途チェックする。
 */
export function isSchemaChangeSql(sql: string): boolean {
  return isSchemaChangeQueryType(classifyStatement(sql));
}

export function validateSqlForExecution(sql: string): SqlQueryType {
  assertSingleStatement(sql);
  assertNoForbiddenSql(sql);
  const queryType = classifyStatement(sql);
  assertSupportedQueryType(queryType);
  assertNoDropOrTruncate(sql);
  assertWhereClauseForMutation(sql, queryType);
  return queryType;
}
