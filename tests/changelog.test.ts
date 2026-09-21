import { describe, expect, it } from "vitest";

import packageJson from "../package.json";
import { APP_CHANGELOG } from "../src/lib/changelog";
import {
  insertChangelogEntry,
  parseReleaseChangelog,
  parseReleaseUsage,
} from "../scripts/version-changelog.mjs";

const HEADER = `export const APP_CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.2.6",
    date: "2026-08-25",
    changes: ["既存のエントリ"],
  },
];
`;

describe("APP_CHANGELOG", () => {
  it("先頭エントリが package.json のバージョンを超えない", () => {
    // 画面で体感できる変化が無いリリースはエントリを作らないため、一致するとは限らない
    const toParts = (version: string) => version.split(".").map(Number);
    const [headMajor, headMinor, headPatch] = toParts(APP_CHANGELOG[0].version);
    const [major, minor, patch] = toParts(packageJson.version);
    const isNotNewer =
      headMajor < major ||
      (headMajor === major && headMinor < minor) ||
      (headMajor === major && headMinor === minor && headPatch <= patch);
    expect(isNotNewer, `${APP_CHANGELOG[0].version} は ${packageJson.version} を超えてはならない`).toBe(
      true,
    );
  });

  it("仮の文言（変更内容を追記してください）が残っていない", () => {
    for (const entry of APP_CHANGELOG) {
      expect(entry.changes.join("\n"), `v${entry.version}`).not.toContain("追記してください");
    }
  });

  it("バージョンが新しい順に並び、重複しない", () => {
    const versions = APP_CHANGELOG.map((entry) => entry.version);
    expect(new Set(versions).size).toBe(versions.length);

    const toParts = (version: string) => version.split(".").map(Number);
    for (let i = 1; i < versions.length; i += 1) {
      const [prevMajor, prevMinor, prevPatch] = toParts(versions[i - 1]);
      const [major, minor, patch] = toParts(versions[i]);
      const isNewer =
        prevMajor > major ||
        (prevMajor === major && prevMinor > minor) ||
        (prevMajor === major && prevMinor === minor && prevPatch > patch);
      expect(isNewer, `${versions[i - 1]} は ${versions[i]} より新しい必要がある`).toBe(true);
    }
  });

  it("日付が YYYY-MM-DD 形式で、変更内容が1件以上ある", () => {
    for (const entry of APP_CHANGELOG) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.changes.length).toBeGreaterThan(0);
    }
  });
});

describe("parseReleaseChangelog", () => {
  it("箇条書き記号・番号を落として1行1項目にそろえる", () => {
    expect(parseReleaseChangelog("- 一覧を追加\n* 検索を追加\n1. 並び替えを追加")).toEqual([
      "一覧を追加",
      "検索を追加",
      "並び替えを追加",
    ]);
  });

  it("未設定・空文字は空配列になる", () => {
    expect(parseReleaseChangelog(undefined)).toEqual([]);
    expect(parseReleaseChangelog("\n  \n")).toEqual([]);
  });
});

describe("parseReleaseUsage", () => {
  it("番号を残したまま行を保つ", () => {
    expect(parseReleaseUsage("1. 設定を開く\n2. 更新履歴を押す")).toEqual([
      "1. 設定を開く",
      "2. 更新履歴を押す",
    ]);
  });
});

describe("insertChangelogEntry", () => {
  it("配列の先頭へ新しいエントリを挿入する", () => {
    const { content, inserted } = insertChangelogEntry(HEADER, "0.3.0", "2026-08-27", [
      "更新履歴を表示",
    ]);

    expect(inserted).toBe(true);
    expect(content.indexOf('version: "0.3.0"')).toBeLessThan(content.indexOf('version: "0.2.6"'));
    expect(content).toContain('date: "2026-08-27"');
    expect(content).toContain('"更新履歴を表示",');
    expect(content).not.toContain("usage:");
  });

  it("changes が空のときはエントリを作らない", () => {
    const { content, inserted } = insertChangelogEntry(HEADER, "0.3.0", "2026-08-27", []);

    expect(inserted).toBe(false);
    expect(content).toBe(HEADER);
  });

  it("changes が空なら usage だけあってもエントリを作らない", () => {
    const { content, inserted } = insertChangelogEntry(
      HEADER,
      "0.3.0",
      "2026-08-27",
      [],
      ["1. 設定を開く"],
    );

    expect(inserted).toBe(false);
    expect(content).toBe(HEADER);
  });

  it("changes が空でもマーカーが無ければ失敗する", () => {
    expect(() => insertChangelogEntry("export const OTHER = [];\n", "0.3.0", "2026-08-27", [])).toThrow(
      "APP_CHANGELOG marker not found",
    );
  });

  it("usage があるときだけ usage を書き出す", () => {
    const { content } = insertChangelogEntry(
      HEADER,
      "0.3.0",
      "2026-08-27",
      ["更新履歴を表示"],
      ["1. 設定を開く"],
    );

    expect(content).toContain("usage: [");
    expect(content).toContain('"1. 設定を開く",');
  });

  it("二重引用符とバックスラッシュをエスケープする", () => {
    const { content } = insertChangelogEntry(HEADER, "0.3.0", "2026-08-27", ['"SQL"実行\\path']);

    expect(content).toContain('"\\"SQL\\"実行\\\\path",');
  });

  it("同じバージョンが既にあれば何もしない", () => {
    const { content, inserted } = insertChangelogEntry(HEADER, "0.2.6", "2026-08-27", ["再挿入"]);

    expect(inserted).toBe(false);
    expect(content).toBe(HEADER);
  });
});
