import { describe, expect, it } from "vitest";
import {
  CrossDatabaseAccessError,
  assertNoCrossDatabaseAccess,
  assertNoDropOrTruncate,
  assertNoExecutableComments,
  assertNoForbiddenSql,
  assertSingleStatement,
  assertSupportedQueryType,
  assertWhereClauseForMutation,
  classifyStatement,
  extractIdentifiers,
  isSchemaChangeSql,
  stripStringsAndComments,
  validateSqlForExecution,
} from "@/lib/sql-guard";

describe("classifyStatement", () => {
  it.each([
    ["SELECT * FROM users", "SELECT"],
    ["insert into users (a) values (1)", "INSERT"],
    ["UPDATE users SET a=1 WHERE id=1", "UPDATE"],
    ["DELETE FROM users WHERE id=1", "DELETE"],
    ["CREATE TABLE foo (id INT)", "CREATE_TABLE"],
    ["ALTER TABLE foo ADD COLUMN bar INT", "ALTER_TABLE"],
    ["DROP TABLE foo", "OTHER"],
    ["TRUNCATE TABLE foo", "OTHER"],
    ["GRANT ALL ON *.* TO 'x'@'%'", "OTHER"],
  ])("%s は %s と判定される", (sql, expected) => {
    expect(classifyStatement(sql)).toBe(expected);
  });
});

describe("classifyStatement（読み取り専用SQL・#85）", () => {
  it.each([
    ["SHOW CREATE TABLE `users`", "SHOW"],
    ["show create view v_users", "SHOW"],
    ["SHOW INDEX FROM users", "SHOW"],
    ["SHOW INDEXES FROM users", "SHOW"],
    ["SHOW KEYS FROM users", "SHOW"],
    ["SHOW TABLE STATUS", "SHOW"],
    ["SHOW TABLES", "SHOW"],
    ["SHOW COLUMNS FROM users", "SHOW"],
    ["SHOW FIELDS FROM users", "SHOW"],
    ["SHOW FULL COLUMNS FROM users", "SHOW"],
    ["SHOW FULL TABLES", "SHOW"],
    ["SHOW TRIGGERS", "SHOW"],
    ["DESCRIBE users", "DESCRIBE"],
    ["desc `users`", "DESCRIBE"],
    ["DESCRIBE users id", "DESCRIBE"],
    ["EXPLAIN SELECT * FROM users WHERE id = 1", "EXPLAIN"],
    ["explain format=json select 1", "EXPLAIN"],
    ["EXPLAIN users", "EXPLAIN"],
  ])("%s は %s と判定される", (sql, expected) => {
    expect(classifyStatement(sql)).toBe(expected);
  });

  it.each([
    // サーバー全体の情報を返すSHOWは対象外（許可リストに載せない）
    ["SHOW GRANTS FOR 'x'@'%'"],
    ["SHOW PROCESSLIST"],
    ["SHOW FULL PROCESSLIST"],
    ["SHOW VARIABLES"],
    ["SHOW GLOBAL VARIABLES"],
    ["SHOW STATUS"],
    ["SHOW ENGINES"],
    ["SHOW DATABASES"],
    ["SHOW SCHEMAS"],
    ["SHOW PRIVILEGES"],
    ["SHOW BINARY LOGS"],
    ["SHOW"],
    // 対象の文を実際に実行してしまう / 他セッションを覗くもの
    ["EXPLAIN ANALYZE SELECT * FROM users"],
    ["EXPLAIN FOR CONNECTION 12"],
    ["EXPLAIN UPDATE users SET a = 1"],
    ["EXPLAIN DELETE FROM users"],
    ["DESCRIBE INSERT INTO users VALUES (1)"],
  ])("%s は OTHER と判定される", (sql) => {
    expect(classifyStatement(sql)).toBe("OTHER");
  });
});

describe("assertSingleStatement", () => {
  it("単一文は通過する", () => {
    expect(() => assertSingleStatement("SELECT * FROM users")).not.toThrow();
  });

  it("末尾セミコロンのみは許容する", () => {
    expect(() => assertSingleStatement("SELECT * FROM users;")).not.toThrow();
  });

  it("複数文は拒否する", () => {
    expect(() =>
      assertSingleStatement("SELECT * FROM users; DROP TABLE users;"),
    ).toThrow();
  });

  it("文字列リテラル内のセミコロンは複数文と誤判定しない", () => {
    expect(() =>
      assertSingleStatement("SELECT * FROM users WHERE name = 'a;b'"),
    ).not.toThrow();
  });
});

describe("assertNoForbiddenSql", () => {
  it.each([
    "GRANT ALL ON *.* TO 'x'@'%'",
    "REVOKE ALL ON *.* FROM 'x'@'%'",
    "CREATE USER 'x'@'%'",
    "DROP USER 'x'@'%'",
    "SET GLOBAL max_connections = 1000",
    "SHUTDOWN",
    "KILL 123",
    "LOAD DATA LOCAL INFILE 'a.csv' INTO TABLE foo",
    "SELECT * FROM foo INTO OUTFILE '/tmp/a.csv'",
    "INSTALL SONAME 'foo'",
  ])("禁止SQL %s を拒否する", (sql) => {
    expect(() => assertNoForbiddenSql(sql)).toThrow();
  });

  it("禁止対象を含まないSQLは通過する", () => {
    expect(() => assertNoForbiddenSql("SELECT * FROM users")).not.toThrow();
  });

  it("文字列リテラル内に禁止ワードが含まれても誤検知しない", () => {
    expect(() =>
      assertNoForbiddenSql("INSERT INTO logs (msg) VALUES ('GRANT access requested')"),
    ).not.toThrow();
  });
});

describe("assertNoDropOrTruncate", () => {
  it("DROPを含むSQLを拒否する", () => {
    expect(() => assertNoDropOrTruncate("DROP TABLE foo")).toThrow();
    expect(() => assertNoDropOrTruncate("ALTER TABLE foo DROP COLUMN bar")).toThrow();
  });

  it("TRUNCATEを含むSQLを拒否する", () => {
    expect(() => assertNoDropOrTruncate("TRUNCATE TABLE foo")).toThrow();
  });

  it("DROP/TRUNCATEを含まないSQLは通過する", () => {
    expect(() => assertNoDropOrTruncate("SELECT * FROM users")).not.toThrow();
  });
});

describe("assertWhereClauseForMutation", () => {
  it("WHERE句のないUPDATEを拒否する", () => {
    expect(() =>
      assertWhereClauseForMutation("UPDATE users SET a=1", "UPDATE"),
    ).toThrow();
  });

  it("WHERE句のないDELETEを拒否する", () => {
    expect(() => assertWhereClauseForMutation("DELETE FROM users", "DELETE")).toThrow();
  });

  it("WHERE句があれば通過する", () => {
    expect(() =>
      assertWhereClauseForMutation("UPDATE users SET a=1 WHERE id=1", "UPDATE"),
    ).not.toThrow();
  });

  it("SELECT/INSERTはWHERE句チェックの対象外", () => {
    expect(() => assertWhereClauseForMutation("SELECT * FROM users", "SELECT")).not.toThrow();
    expect(() =>
      assertWhereClauseForMutation("INSERT INTO users (a) VALUES (1)", "INSERT"),
    ).not.toThrow();
  });
});

describe("assertSupportedQueryType", () => {
  it("OTHER種別を拒否する", () => {
    expect(() => assertSupportedQueryType("OTHER")).toThrow();
  });

  it("サポート対象の種別は通過する", () => {
    for (const type of [
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "CREATE_TABLE",
      "ALTER_TABLE",
      "SHOW",
      "DESCRIBE",
      "EXPLAIN",
    ] as const) {
      expect(() => assertSupportedQueryType(type)).not.toThrow();
    }
  });
});

describe("validateSqlForExecution（統合）", () => {
  it("正常なSELECTを通過させる", () => {
    expect(validateSqlForExecution("SELECT * FROM users WHERE id = 1")).toBe("SELECT");
  });

  it("DROP TABLEを拒否する（この画面では専用機能に誘導）", () => {
    expect(() => validateSqlForExecution("DROP TABLE users")).toThrow();
  });

  it("条件なしDELETEを拒否する", () => {
    expect(() => validateSqlForExecution("DELETE FROM users")).toThrow();
  });

  it("複数文を拒否する", () => {
    expect(() =>
      validateSqlForExecution("SELECT 1; SELECT 2;"),
    ).toThrow();
  });

  it("GRANTを拒否する", () => {
    expect(() => validateSqlForExecution("GRANT ALL ON *.* TO 'x'@'%'")).toThrow();
  });

  it.each([
    ["SHOW CREATE TABLE users", "SHOW"],
    ["SHOW INDEX FROM users", "SHOW"],
    ["DESCRIBE users", "DESCRIBE"],
    ["EXPLAIN SELECT * FROM users", "EXPLAIN"],
  ])("読み取り専用SQL %s を通過させる", (sql, expected) => {
    expect(validateSqlForExecution(sql)).toBe(expected);
  });

  it("SHOW GRANTSは種別判定の対象外として拒否する", () => {
    expect(() => validateSqlForExecution("SHOW GRANTS FOR 'x'@'%'")).toThrow();
  });

  it("SHOW GRANTSを落としているのは許可リストだけで、禁止SQL判定では通ってしまう", () => {
    // /\bGRANT\b/i は "GRANTS" に一致しない。許可リストを拒否リストへ変えると通る。
    expect(() => assertNoForbiddenSql("SHOW GRANTS FOR 'x'@'%'")).not.toThrow();
    expect(classifyStatement("SHOW GRANTS FOR 'x'@'%'")).toBe("OTHER");
  });

  it("SHOW CREATE USERは禁止SQLとして拒否する", () => {
    expect(() => validateSqlForExecution("SHOW CREATE USER 'x'@'%'")).toThrow();
  });

  it("EXPLAIN ANALYZEは対象文を実行するため拒否する", () => {
    expect(() =>
      validateSqlForExecution("EXPLAIN ANALYZE SELECT * FROM users"),
    ).toThrow();
  });
});

describe("isSchemaChangeSql", () => {
  // #105: 構造（DDL）を変えるSQLだけ、実行前に確認と本人確認を求める。
  it.each([
    "CREATE TABLE t (id INT)",
    "  create table `t` (id int)",
    "ALTER TABLE t ADD COLUMN name VARCHAR(10)",
  ])("構造を変えるSQLを検知する: %s", (sql) => {
    expect(isSchemaChangeSql(sql)).toBe(true);
  });

  it.each([
    "SELECT * FROM t",
    "INSERT INTO t (id) VALUES (1)",
    "UPDATE t SET id = 2 WHERE id = 1",
    "DELETE FROM t WHERE id = 1",
    "SHOW CREATE TABLE t",
    "DESCRIBE t",
    "EXPLAIN SELECT * FROM t",
    "",
  ])("構造を変えないSQLは対象外にする: %s", (sql) => {
    expect(isSchemaChangeSql(sql)).toBe(false);
  });
});

describe("assertNoCrossDatabaseAccess（#134）", () => {
  // app_a の画面を開いている。app_b は GRANT 済みだが許可リスト外（除外中を含む）のDB。
  const existing = ["app_a", "app_b", "Wordpress"];
  const run = (sql: string, queryType: Parameters<typeof assertNoCrossDatabaseAccess>[1] = "SELECT") =>
    assertNoCrossDatabaseAccess(sql, queryType, "app_a", existing);

  it.each([
    "SELECT * FROM app_b.users",
    "SELECT * FROM `app_b`.`users`",
    "SELECT * FROM app_b . users",
    "SELECT * FROM app_b/* x */./* y */users",
    "SELECT * FROM APP_B.users",
    'SELECT * FROM "app_b".users',
    "SELECT * FROM users u JOIN app_b.orders o ON o.user_id = u.id",
    "SELECT (SELECT COUNT(*) FROM app_b.users) AS n",
    "SELECT app_b.fn(1)",
    "INSERT INTO users (name) SELECT name FROM app_b.users",
    "UPDATE app_b.users SET a = 1 WHERE id = 1",
    "DELETE FROM app_b.users WHERE id = 1",
    "CREATE TABLE app_b.t (id INT)",
    "CREATE TABLE t LIKE app_b.users",
    "ALTER TABLE app_b.t ADD COLUMN c INT",
    "ALTER TABLE t RENAME TO app_b.t",
    "DESCRIBE app_b.users",
    "EXPLAIN SELECT * FROM app_b.users",
    "SELECT * FROM wordpress.wp_posts",
    // `--` の直後が空白でなければコメントではなく、`FROM app_b.t` はそのまま実行される
    "SELECT 1--1 FROM app_b.t",
    "SELECT 1\n--1 FROM app_b.t",
  ])("別のDBを名前で指すSQLを拒否する: %s", (sql) => {
    expect(() => run(sql)).toThrow(CrossDatabaseAccessError);
  });

  it.each([
    "SHOW TABLES FROM app_b",
    "SHOW TABLES IN app_b",
    "SHOW FULL TABLES FROM `app_b`",
    "SHOW COLUMNS FROM users FROM app_b",
    "SHOW INDEX FROM users IN app_b",
    "SHOW TABLE STATUS FROM app_b",
    "SHOW CREATE DATABASE app_b",
    "SHOW CREATE TABLE app_b.users",
    "SHOW TRIGGERS FROM app_b",
  ])("SHOW で別のDBを指定するSQLを拒否する: %s", (sql) => {
    expect(() => run(sql, "SHOW")).toThrow(CrossDatabaseAccessError);
  });

  it.each([
    "SELECT * FROM users",
    "SELECT * FROM app_a.users",
    "SELECT * FROM `app_a`.`users`",
    "SELECT u.id FROM users u",
    // 文字列リテラル・コメントの中は識別子ではない
    "SELECT * FROM users WHERE name = 'app_b.users'",
    "SELECT * FROM users WHERE name = \"app_b\"",
    "SELECT * FROM users -- app_b.users",
    "SELECT * FROM users # app_b.users",
    "SELECT * FROM users /* app_b.users */",
    // 別のDB名を列名・テーブル名として使うだけ（`.` の直前ではない）
    "SELECT app_b FROM users",
    "SELECT u.app_b FROM users u",
    // 接頭辞が同じだけの別名
    "SELECT * FROM app_b2.users",
    "SELECT * FROM xapp_b.users",
    // システムDBは呼び出し側で existingDatabaseNames から外す前提（ここでは通る）
    "SELECT * FROM information_schema.tables",
  ])("開いているDBだけを指すSQLは通す: %s", (sql) => {
    expect(() => run(sql)).not.toThrow();
  });

  it.each([
    "SHOW TABLES",
    "SHOW TABLES FROM app_a",
    "SHOW COLUMNS FROM users",
    "SHOW CREATE TABLE users",
    "SHOW TABLES LIKE 'app_b'",
    'SHOW TABLES LIKE "app_b"',
    "SHOW TABLES FROM information_schema",
  ])("開いているDBだけを指すSHOWは通す: %s", (sql) => {
    expect(() => run(sql, "SHOW")).not.toThrow();
  });

  it("SHOW 以外では、`.` を伴わない別DB名の識別子は拒否しない", () => {
    expect(() => run("SELECT * FROM app_b")).not.toThrow();
  });

  it("他にDBが無ければ何も拒否しない", () => {
    expect(() =>
      assertNoCrossDatabaseAccess("SELECT * FROM app_b.t", "SELECT", "app_a", ["app_a"]),
    ).not.toThrow();
  });

  it("エラーメッセージに参照先のDB名を含める", () => {
    expect(() => run("SELECT * FROM app_b.users")).toThrow(/app_b/);
  });

  it("バッククォート内の連続バッククォートを1文字として読む", () => {
    expect(() =>
      assertNoCrossDatabaseAccess("SELECT * FROM `a``b`.t", "SELECT", "app_a", ["a`b"]),
    ).toThrow(CrossDatabaseAccessError);
  });
});

describe("extractIdentifiers", () => {
  it("引用符なし・バッククォート・二重引用符の識別子と、直後のドットを取り出す", () => {
    expect(extractIdentifiers("SELECT a.b, `c d`.`e` FROM \"f\"")).toEqual([
      { name: "SELECT", quote: "none", followedByDot: false },
      { name: "a", quote: "none", followedByDot: true },
      { name: "b", quote: "none", followedByDot: false },
      { name: "c d", quote: "backtick", followedByDot: true },
      { name: "e", quote: "backtick", followedByDot: false },
      { name: "FROM", quote: "none", followedByDot: false },
      { name: "f", quote: "double", followedByDot: false },
    ]);
  });

  it("文字列リテラルとコメントは識別子に含めない", () => {
    expect(extractIdentifiers("SELECT 'x.y' /* z.w */ -- q.r\n")).toEqual([
      { name: "SELECT", quote: "none", followedByDot: false },
    ]);
  });
});

describe("assertNoExecutableComments（#134）", () => {
  it.each([
    "SELECT * FROM /*! app_b.users */ t",
    "SELECT 1 /*!50000 + 1 */",
    "SELECT 1 /*M! + 1 */",
  ])("実行可能コメントを拒否する: %s", (sql) => {
    expect(() => assertNoExecutableComments(sql)).toThrow();
    expect(() => validateSqlForExecution(sql)).toThrow();
  });

  it.each([
    "SELECT 1 /* 普通のコメント */",
    "SELECT 1 /*+ MAX_EXECUTION_TIME(1000) */",
    "SELECT '/*! literal */'",
    "SELECT 1 -- /*! comment",
    "SELECT `/*!`",
  ])("普通のコメントや文字列リテラルは通す: %s", (sql) => {
    expect(() => assertNoExecutableComments(sql)).not.toThrow();
  });
});

describe("stripStringsAndComments（`--` の扱い）", () => {
  it("`--` の直後が空白なら行コメントとして落とす", () => {
    expect(stripStringsAndComments("SELECT 1 -- INTO OUTFILE 'x'\n")).toBe("SELECT 1 \n");
    expect(stripStringsAndComments("SELECT 1 --")).toBe("SELECT 1 ");
  });

  it("`--` の直後が空白でなければコメントではないので、続きも検査対象に残す", () => {
    expect(stripStringsAndComments("SELECT 1--1 FROM t INTO OUTFILE 'x'")).toContain("INTO OUTFILE");
    expect(() => assertNoForbiddenSql("SELECT 1--1 FROM t INTO OUTFILE 'x'")).toThrow();
  });
});
