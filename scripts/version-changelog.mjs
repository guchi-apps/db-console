#!/usr/bin/env node
/**
 * `npm version` の lifecycle 用: 更新履歴（`src/lib/changelog.ts`）の先頭へ新バージョンの
 * エントリを追加する。
 *
 * develop→mainのリリースフロー（`.github/workflows/release-develop-to-main.yml` が参照する
 * 共有ワークフロー）は、developへ取り込まれた差分から利用者向けの文面を2種類生成し、
 * 環境変数で渡してくる。
 *
 * - `RELEASE_CHANGELOG` — 何が変わったか
 * - `RELEASE_USAGE` — どう使うか。番号付きの複数行。**画面で使える変化が無いリリースでは空**で
 *   渡るため、その場合は `usage` を書かない
 *
 * 未設定・空のとき（手元で `npm version` を叩いた場合など）は、後から手で埋めるための枠だけを作る。
 *
 * **依存関係に触れてはいけない。** 共有ワークフローはバージョンbumpのために依存を
 * インストールしないため、Node標準モジュールだけで完結させる（`preversion` も作らない）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const changelogPath = join(dirname(fileURLToPath(import.meta.url)), "../src/lib/changelog.ts");

export const CHANGELOG_PLACEHOLDER = "（変更内容を追記してください）";

const CHANGELOG_MARKER = "export const APP_CHANGELOG: ChangelogEntry[] = [";

/**
 * `RELEASE_CHANGELOG` の文面を `changes` 配列へ整形する。生成される文面は箇条書き・段落の
 * どちらもありうるため、行単位に分解し、箇条書き記号と番号を落として1行1項目にそろえる。
 */
export function parseReleaseChangelog(raw) {
  return (raw ?? "")
    .split("\n")
    .map((line) => line.trim().replace(/^(?:[-*・]|\d+[.)])\s*/, "").trim())
    .filter((line) => line !== "");
}

/**
 * `RELEASE_USAGE` の文面を `usage` 配列へ整形する。`1. ` で始まる行が改行で並ぶ契約のため、
 * **番号は落とさず**行をそのまま残す（画面側は番号付きリストとして出す）。
 */
export function parseReleaseUsage(raw) {
  return (raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

// 生成された文面をそのまま埋め込むため、TypeScriptの文字列リテラルを壊さないようにする。
function escapeForTs(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function insertChangelogEntry(content, version, date, changes = [], usage = []) {
  if (content.includes(`version: "${version}"`)) {
    return { content, inserted: false };
  }

  const index = content.indexOf(CHANGELOG_MARKER);
  if (index === -1) {
    throw new Error("APP_CHANGELOG marker not found in changelog.ts");
  }

  const items = changes.length > 0 ? changes : [CHANGELOG_PLACEHOLDER];
  const usageBlock =
    usage.length > 0
      ? `\n    usage: [\n${usage.map((item) => `      "${escapeForTs(item)}",`).join("\n")}\n    ],`
      : "";
  const entry = `
  {
    version: "${version}",
    date: "${date}",
    changes: [
${items.map((item) => `      "${escapeForTs(item)}",`).join("\n")}
    ],${usageBlock}
  },`;

  const insertAt = index + CHANGELOG_MARKER.length;
  return {
    content: `${content.slice(0, insertAt)}${entry}${content.slice(insertAt)}`,
    inserted: true,
  };
}

function todayJst() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}

function main() {
  const version = process.env.npm_package_version;
  if (!version) {
    throw new Error("npm_package_version is not set (run via npm version)");
  }

  const changes = parseReleaseChangelog(process.env.RELEASE_CHANGELOG);
  const usage = parseReleaseUsage(process.env.RELEASE_USAGE);
  const original = readFileSync(changelogPath, "utf8");
  const { content, inserted } = insertChangelogEntry(original, version, todayJst(), changes, usage);

  if (!inserted) {
    console.log(`changelog.ts already has version ${version}; skipping.`);
    return;
  }

  writeFileSync(changelogPath, content, "utf8");
  if (changes.length > 0) {
    console.log(
      `Added changelog entry for v${version} (${changes.length} change(s), ${usage.length} usage line(s))`,
    );
  } else {
    console.log(`Added changelog stub for v${version}`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  main();
}
