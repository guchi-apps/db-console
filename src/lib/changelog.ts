export type ChangelogEntry = {
  version: string;
  /** ISO 8601 (YYYY-MM-DD) */
  date: string;
  /** 何が変わったか。1項目1行 */
  changes: string[];
  /**
   * どう使うか（どこを開く / 何を押す / どうなれば成功か）。
   * 画面で使える変化が無いリリースでは共有ワークフローが生成しないため、その場合は持たせない
   * （空配列ではなく未定義にする。画面は `usage` が無いときに枠ごと出さない）。
   */
  usage?: string[];
};

/**
 * 設定 →「更新履歴」に表示するデータ。
 *
 * ## 追記の仕方
 *
 * **手で書き足す必要は無い。** develop→mainのリリースフロー
 * （`.github/workflows/release-develop-to-main.yml`）が差分から利用者向けの文面を生成し、
 * バージョンbump時の `version` lifecycleスクリプト（`scripts/version-changelog.mjs`）が
 * この配列の先頭へ新しいエントリを挿入する。生成された文面はバンプPRの本文にも載るため、
 * 内容の確認はそこで行う。
 *
 * ## 記載ルール（手で直すときに守ること）
 *
 * - 利用者が画面を見て体感できる変更だけを書く
 * - 内部実装・リファクタリング・CI/CD・依存関係の更新は書かない
 * - 開発者向けの用語は利用者向けの言い方に言い換える
 * - 過去バージョンのエントリは変更しない
 *
 * 新しい順に並べる。先頭は常に `package.json` の `version` と一致する
 * （`tests/changelog.test.ts` で検証している）。
 */
export const APP_CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.2.6",
    date: "2026-08-25",
    changes: [
      "これより前の更新内容は記録していません。次のリリースから、変更点をここに表示します。",
    ],
  },
];
