<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# db-console — エージェント向けガイド

スマートフォン向けMariaDB管理画面。技術スタックとセットアップ手順は [README.md](./README.md) を参照する。
ここにはエージェント（Claude Code）が守る運用ルールと、READMEに書かれていない判断基準だけを書く。

**GitHub Actions 上での無人実行は、このリポジトリをチェックアウトしたワークツリーしか参照できない。**
ローカル実行ではユーザー個人環境のグローバルルール（`~/.claude/CLAUDE.md`）も読み込まれるが、
無人実行では読み込まれない。したがって無人実行でも守られる必要があるルールは、このファイルに
明文化しておく必要がある。

## このリポジトリが扱うもの

**他アプリのDBを直接操作する管理コンソールである。** SQLの実行経路（`src/lib` のクエリ実行・
識別子のエスケープ・SQLガード）に触れる変更は、影響がこのアプリの中で閉じない。テストの追加なしに
振る舞いを変えないこと。

## 検証コマンド

**`typecheck` の npm script は無い。** CI（`.github/workflows/ci.yml`）は `npx tsc --noEmit` を直接
叩いている。**存在しないコマンドを探さず、下記を使うこと。**

| 目的 | コマンド |
|---|---|
| Lint | `npm run lint` |
| 型チェック | `npx tsc --noEmit` |
| テスト | `npm test`（vitest） |
| ビルド | 下記のとおり環境変数が要る |

**`npm run build` は素で実行すると落ちる。** `/auth/callback` のページデータ収集で Supabase の
URLが `undefined` になり `ERR_INVALID_URL` で失敗する。`.env.local` が無い環境（クローン直後・
GitHub Actions の無人実行）では、CI と同じプレースホルダーを渡して実行する。

```bash
DATABASE_URL=mysql://root@127.0.0.1:3306/db_console_test \
NEXT_PUBLIC_SUPABASE_URL=https://dummy-project.supabase.co \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy-publishable-key-for-ci-only \
ALLOWED_EMAILS=test@example.com \
npm run build
```

値は `.github/workflows/ci.yml` の `env:` と同じもので、**実シークレットではない**（接続もしない）。

`npm run dev`・`npm run db:migrate` は `.env.local` を `source` するため無人実行では使えない。
**`db:migrate:deploy` の npm script は無い**（共有ワークフローが `--if-present` で呼ぶため落ちないが、
マイグレーションは実行されない）。マイグレーションが要る変更では、`npx prisma migrate deploy` を
明示的に使う。

`prisma.config.ts` は DATABASE_URL が未設定のとき、接続できないプレースホルダーへ倒す。
**これが無いと `npm ci` の postinstall（`prisma generate`）ごと落ちる。** 詳細はファイル内のコメントを参照。

CIのDBは **MariaDB 10.11**。本番がMariaDBで、このアプリはMariaDB固有の挙動（`mariadb` ドライバ）を
扱うため、他アプリの `mysql:8.0` とは揃えていない。

## マルチエージェント運用（GitHub Actions 無人実行）

`@claude` コメントを起点に、計画提示〜実装〜develop向けPR作成までを GitHub Actions 上で無人実行する。
ワークフローの実体は `guchi-apps/issue-deck` にあり、このリポジトリの `.github/workflows/` には
`uses:` で参照する薄い caller だけを置いている（`@workflows/v18`）。

設計・運用の詳細は issue-deck 側を参照する。

- 進捗管理の設計: [progress-status-architecture.md](https://github.com/guchi-apps/issue-deck/blob/main/docs/progress-status-architecture.md)
- 無人実行の挙動: [multi-agent/dispatch.md](https://github.com/guchi-apps/issue-deck/blob/main/docs/multi-agent/dispatch.md)

### ブランチ

- 機能開発: `develop`（**デフォルトブランチ**）
- 安定版 / 本番デプロイ: `main`（マージ時に GitHub Actions が VPS へデプロイ）

Issue専用ブランチは `develop` から作成し、ブランチ名は **`issue-<Issue番号>`** とする（例: `issue-19`）。
ワークフローはブランチ名から対象Issueを特定するため、**この命名規約に従わないブランチはすべて対象外**になる。

デフォルトブランチは `develop` から変えない。`issues`・`issue_comment` イベントはデフォルトブランチの
ワークフローしか起動しないため、`main` に戻すと `@claude` コメントに反応しなくなる。

### Issueの進捗

**進捗は GitHub Projects の Status で管理する。進捗ラベルは存在しない**
（issue-deck#1010 / #991 Phase 5 で `01.wip`〜`09.main` を廃止した）。

1. `Ready` — 未着手
2. `Planning` — 計画検討中（`21.plan-required` 選択時のみ経由）
3. `Implementation` — 実装中
4. `Develop PR` — developへPR作成・マージ中
5. `Develop` — developへマージ完了（main未反映）
6. `Release` — mainへPR作成・マージ中
7. `Done` — mainへマージ完了。この時点でissueをcloseする

**`gh issue edit` で進捗を進めることはできない。** Status を書けるのは issue-deck だけで、
ワークフローは進捗報告API（`POST /api/progress`）へ報告する。ブランチのpush・PR作成・PRマージを
トリガーに自動で遷移するため、エージェントが自分で進捗を動かす必要はない。

### リリース（develop→main）

**リリースは issue-deck の画面から起動する。** ヘッダーのロケットアイコン、またはブランチの流れ画面の
リリースボタンが `.github/workflows/release-develop-to-main.yml` を `workflow_dispatch` で起動し、
次の順に進む（issue-deck#1551）。

1. バージョンbump PR（`release/vX.Y.Z` → `develop`）が作られる。上げ幅は main と develop のコード差分から
   自動判定する。CI通過後に develop へ自動マージされる
2. バンプPRのマージで `package.json` が変わると同じワークフローが再度起動し、develop → main の
   リリースPRを作る
3. **リリースPRのマージは人が行う**（自動マージ不可カテゴリ）。マージすると `deploy.yml` が
   `v<version>` タグを作り、VPS へデプロイする

エージェントはこのフローを自分で起動しない。バージョンを手で書き換える必要もない
（`package.json` の `version` はバンプPRだけが更新する）。

### 条件を表すラベル（進捗とは別軸）

Status = 今どこにいるか、Label = どんな性質・条件があるか、という役割分担にしている。

| ラベル | 意味 |
|---|---|
| `00.check-user` | ユーザーの確認・指示が必要。どの段階でも併用する |
| `00.qa-answered` | 質問への回答のみ完了（`00.check-user` と常に併用） |
| `11.local` | ローカル（VSCode等）で対応中。付いている間は無人実行を起動しない |
| `21.plan-required` | 実装前に計画を提示し承認を得る |
| `22.merge-confirm-required` | 内容によらず、developへのマージ前に必ず `00.check-user` を付ける |
| `23.preview-required` | PR作成前に開発サーバーでの画面確認を必須にする |
| `24.screenshot-required` | PR作成前にスクリーンショット取得を必須にする |
| `71.manual-step` | エージェントが代行できないユーザー自身の手作業 |

### 自動マージ不可カテゴリ

以下に該当する変更は自動マージせず `00.check-user` を付与してユーザーの確認を待つ。

- 認証・認可（Supabase Auth まわり・`src/proxy.ts`）
- **SQLの実行経路**（識別子のエスケープ・SQLガード・接続ユーザーの権限）
- DBスキーマ変更・マイグレーション（`prisma/migrations/**`）
- 本番環境の設定（`deploy/**`）
- GitHub Actionsやデプロイ設定（`.github/workflows/**`）
- Secretsや環境変数（`.env*`・`scripts/sync-github-secrets.sh`）
- 課金・決済
- 大規模な依存関係の更新
- `develop` → `main` のマージ

### 実装エージェントの禁止事項

- `main` / `develop` への直接コミット・push
- 他Issueのブランチの編集
- 担当Issue以外の実装（別件を新規Issueとして起票するのはよい）
- 不要なforce push
- 自分が作成したPull Requestの自己マージ
- **本番DBへの接続・変更**（`npm run db:tunnel:prod`・`npm run dev:prod-db` を無人実行で使わない）

### コミット・PR・コメントの書き方

- コミットメッセージ・PRタイトル・PR本文・issueコメントは**日本語**で書く
- コミットの author は `Claude Code <claude-code@example.com>` にする
- `develop` 宛のPR本文には、対応Issue・実装内容・テスト内容・確認方法・注意点を記載する。
  developマージ時点ではissueをcloseしない運用のため、`closes #番号` / `fixes #番号` は使わず
  `#番号` のみ記載する

### 依存関係の追加

新しい依存関係を追加する前には、必ずユーザーに確認を取る。無人実行では確認相手がいないため、
追加が必要だと判断した場合は追加せずに作業を止め、`00.check-user` を付与したうえで
なぜ必要かをIssueコメントで相談する。

### シークレットの扱い

APIキー・トークン・パスワード等の実シークレットをコミットしない。コミットしてよいのは値を空にした
サンプル（`.env.example`・`.env.op.example`）と、1Passwordの `op://vault/item/field` 形式の参照だけを
書いたテンプレート（`.env.tpl`）に限る。実値は `.gitignore` 済みの `.env*` と1Password側、および
GitHubのsecret/variableにのみ置く。

**実行時の1Password呼び出しは行わない**（issue-deck#1307）。GitHub Actions は GitHubの
secret/variable から値を取得する。
