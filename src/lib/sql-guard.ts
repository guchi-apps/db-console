import type { SqlQueryType } from "@prisma/client";

/**
 * `--` 行コメントの開始か。MySQL/MariaDB は `--` の直後に空白か制御文字が無いとコメントとみなさず、
 * `SELECT 1--1` は `1 - (-1)` として続きを実行する。無条件にコメント扱いすると、
 * `--` 以降に書いた `FROM app_b.t` のような部分をガードが見落とす。
 */
function isLineDashComment(sql: string, i: number): boolean {
  if (sql[i] !== "-" || sql[i + 1] !== "-") return false;
  const next = sql[i + 2];
  return next === undefined || /[\s\x00-\x1f]/.test(next);
}

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

    if (isLineDashComment(sql, i)) {
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

/**
 * MySQL/MariaDB は、開きが `/*!` または `/*M!` のコメント（実行可能コメント）の中身を
 * コメントではなくSQLとして実行する。
 * ガードのキーワード検知・DB参照検知はコメントを読み飛ばすため、ここに書かれると検知をすり抜ける。
 * 読み飛ばしを正しく保つため、実行可能コメントはこの画面では受け付けない。
 */
export function assertNoExecutableComments(sql: string): void {
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipQuoted(sql, i);
      continue;
    }
    if (isLineDashComment(sql, i) || ch === "#") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      if (sql[i + 2] === "!" || (sql[i + 2] === "M" && sql[i + 3] === "!")) {
        throw new Error("実行可能コメント（/*! ... */）を含むSQLは実行できません");
      }
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    i++;
  }
}

/** `start` にある引用符の開始位置から、対応する閉じ引用符の次の位置を返す。 */
function skipQuoted(sql: string, start: number): number {
  return readQuoted(sql, start).next;
}

/** 引用符（' " `）で囲まれた部分を読み、中身（エスケープ解除済み）と次の位置を返す。 */
function readQuoted(sql: string, start: number): { value: string; next: number } {
  const quote = sql[start];
  let value = "";
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === "\\" && quote !== "`") {
      value += sql[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) {
        value += quote;
        i += 2;
        continue;
      }
      return { value, next: i + 1 };
    }
    value += sql[i];
    i++;
  }
  return { value, next: i };
}

export interface IdentifierToken {
  name: string;
  /** バッククォート・二重引用符で囲まれていたか。 */
  quote: "none" | "backtick" | "double";
  /** 直後（空白・コメントを挟んでよい）に `.` が続くか。`db.table` の `db` 側の判定に使う。 */
  followedByDot: boolean;
}

/**
 * SQL中の識別子（引用符なしの語・バッククォート囲み・二重引用符囲み）を出現順に取り出す。
 * 文字列リテラル（'...'）とコメントは読み飛ばす。二重引用符は既定では文字列だが、
 * ANSI_QUOTES では識別子になるため、識別子の候補として拾う（判定側で扱いを分ける）。
 */
export function extractIdentifiers(sql: string): IdentifierToken[] {
  type Raw = { kind: "ident"; name: string; quote: IdentifierToken["quote"] } | { kind: "dot" } | { kind: "other" };
  const raw: Raw[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      raw.push({ kind: "other" });
      i = skipQuoted(sql, i);
      continue;
    }
    if (ch === "`" || ch === '"') {
      const { value, next } = readQuoted(sql, i);
      raw.push({ kind: "ident", name: value, quote: ch === "`" ? "backtick" : "double" });
      i = next;
      continue;
    }
    if (isLineDashComment(sql, i) || ch === "#") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === ".") {
      raw.push({ kind: "dot" });
      i++;
      continue;
    }
    if (/[A-Za-z0-9_$\u0080-￿]/.test(ch)) {
      let end = i + 1;
      while (end < sql.length && /[A-Za-z0-9_$\u0080-￿]/.test(sql[end])) end++;
      raw.push({ kind: "ident", name: sql.slice(i, end), quote: "none" });
      i = end;
      continue;
    }
    raw.push({ kind: "other" });
    i++;
  }

  const tokens: IdentifierToken[] = [];
  raw.forEach((token, index) => {
    if (token.kind !== "ident") return;
    tokens.push({
      name: token.name,
      quote: token.quote,
      followedByDot: raw[index + 1]?.kind === "dot",
    });
  });
  return tokens;
}

export class CrossDatabaseAccessError extends Error {
  constructor(databaseName: string) {
    super(
      `別のDB（${databaseName}）を参照するSQLは実行できません。この画面では開いているDBだけを操作できます`,
    );
    this.name = "CrossDatabaseAccessError";
  }
}

/**
 * 開いているDB以外のDBを名前で指すSQLを拒否する（#134）。
 * 許可リストの判定（getPoolForOperation）は画面のパスにあるDB名しか見ないうえ、
 * data/schema ロールは GRANT 済みのDBすべてに権限を持つため、`app_a` の画面から
 * `SELECT * FROM app_b.users` を流せば、許可リスト外・除外中の `app_b` にも読み書き・DDLが通ってしまう。
 *
 * `existingDatabaseNames` は接続ロールから見えるDB名（information_schema.schemata）。
 * SQLだけでは `db.table` と `alias.column` を区別できないため、「実在するDB名と一致する識別子」を
 * 見て判定する。次のいずれかで、開いているDB以外の名前が出てきたら拒否する。
 * - 識別子の直後に `.` が続く（`app_b.t` / `` `app_b`.`t` ``）
 * - SHOW で識別子として書かれている（`SHOW TABLES FROM app_b` / `SHOW CREATE DATABASE app_b`）
 *
 * 実在するDB名と同じ名前のエイリアスを `.` 付きで使うSQLも拒否される（安全側の誤検知）。
 * システムDB（information_schema 等）は呼び出し側で `existingDatabaseNames` から外す。
 */
export function assertNoCrossDatabaseAccess(
  sql: string,
  queryType: SqlQueryType,
  currentDatabaseName: string,
  existingDatabaseNames: readonly string[],
): void {
  const otherNames = new Set(
    existingDatabaseNames
      .filter((name) => name !== currentDatabaseName)
      .map((name) => name.toLowerCase()),
  );
  if (otherNames.size === 0) return;

  for (const token of extractIdentifiers(sql)) {
    if (token.name === currentDatabaseName) continue;
    if (!otherNames.has(token.name.toLowerCase())) continue;
    const isShowIdentifier = queryType === "SHOW" && token.quote !== "double";
    if (token.followedByDot || isShowIdentifier) {
      throw new CrossDatabaseAccessError(token.name);
    }
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
  assertNoExecutableComments(sql);
  assertNoForbiddenSql(sql);
  const queryType = classifyStatement(sql);
  assertSupportedQueryType(queryType);
  assertNoDropOrTruncate(sql);
  assertWhereClauseForMutation(sql, queryType);
  return queryType;
}
