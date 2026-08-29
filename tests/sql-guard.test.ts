import { describe, expect, it } from "vitest";
import {
  assertNoDropOrTruncate,
  assertNoForbiddenSql,
  assertSingleStatement,
  assertSupportedQueryType,
  assertWhereClauseForMutation,
  classifyStatement,
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
