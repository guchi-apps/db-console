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

### テーブルとビュー（VIEW）

一覧・レコード閲覧はビューも対象にするが、**ビューは閲覧のみ**（#86）。実在確認の関数を
`src/lib/identifier.ts` で2つに分けており、**書き込み・DDLの経路では必ず後者を使う**。

| 関数 | 通すもの | 使う場所 |
|---|---|---|
| `assertTableExists()` | テーブル + ビュー | カラム・インデックス・レコードの読み取り |
| `assertBaseTableExists()` | テーブルのみ（ビューは `ViewNotModifiableError`） | `insertRow`・`updateRow`・`deleteRows` と全DDL |

**`SHOW CREATE VIEW` / ビューへの `SHOW CREATE TABLE` は使わない。** どちらも `SHOW VIEW` 権限が
無いと `SHOW VIEW command denied` で落ちる。ビュー定義は `information_schema.views.view_definition`
から読む——こちらは権限が無い場合にエラーではなく**空文字**を返すため、画面で「表示できない」と
伝えるだけで済む。`getTableStructureSql()`（SQL出力）がビューを拒否し、構造画面でSQL出力の導線を
出していないのも同じ理由。

`SHOW VIEW` はローカルの `scripts/setup-db.sh` では両ロールへ付与済み。**本番VPSのロールには
付いていない**ため、本番でビュー定義を表示するにはGRANTの追加が要る（#86 から切り出した手作業Issue）。

### DBの作成とDBユーザーの管理（#91）

接続ロールは3つあり、**用途ごとにプールを分けている**。強い権限を持つ管理ロールは
`src/lib/admin-db.ts` の `getAdminPool()` からしか触らない（SQL実行画面は
`getPoolForOperation()` 経由の data/schema プールしか使わないため、画面から任意の
GRANT文を流す経路は無い、という前提を壊さないこと）。

| ロール | 権限 | 使う場所 |
|---|---|---|
| `db_console_data` | 管理対象DBへの SELECT/INSERT/UPDATE/DELETE | レコード操作 |
| `db_console_schema` | + CREATE/ALTER/DROP/INDEX | DDL |
| `db_console_admin` | `` `app\_%` `` へ GRANT OPTION 付き、グローバルの `CREATE USER`、`mysql.user`/`mysql.db` の SELECT | DB作成・DBユーザー管理（`src/lib/admin-db.ts`・`src/lib/db-users.ts`）だけ |

**GRANT / REVOKE のDB名は `toDatabaseGrantPattern()`（`src/lib/identifier.ts`）でエスケープする。**
MySQL/MariaDBはGRANT文のDB名を「パターン」として扱い、付与する側が持つパターンに含まれることを
要求する。管理ロールの権限は `` `app\_%` `` なので、`GRANT ... ON \`app_car\`.*` は `_` が
ワイルドカードのまま比較されて `Access denied ... to database 'app_car'` で落ちる。
`` `app\_car` `` へエスケープすると通り、効果は `app_car` だけに掛かる（MySQL 8.0.46 で確認）。
`mysql.db` の `Db` カラムにもエスケープ済みの形で入るため、読むときは
`fromDatabaseGrantPattern()` でDB名へ戻す。

**GRANTの直後に接続プールを張り直す必要は無い。** このアプリは `USE` を発行せず既定DBも持たない
ため、完全修飾名でのアクセスは毎回ACLを引き直す（GRANT前から張っていたコネクションで新DBが
見えることを実測済み。#91）。

作成・権限変更の対象は `app_` で始まるDB・ユーザーだけ（`MANAGED_NAME_PREFIX`）。パスワードは
保存せず、作成・再発行の直後に画面で1度だけ表示する。**本番VPSには `db_console_admin` ロールが
無い**ため、作られるまで本番の画面には「未設定」と出る（#91 から切り出した手作業Issue）。

### `app_` で始まるDBの自動登録（#97）

`app_` で始まるDBは登録操作なしで管理対象になる。DB一覧・設定画面の描画時に
`src/lib/managed-db-sync.ts` の `syncManagedAppDatabases()` が走り、未登録のものを
**GRANT してから** `ManagedDatabase` へ登録する（既定モードは `data-write`）。

**列挙は管理ロールでなければできない。** `db_console_data` / `db_console_schema` の
`information_schema.schemata` は**GRANT済みのDBしか返さない**ため、
`listRegistrableDatabaseNames()`（`src/lib/target-db.ts`）には「まだGRANTしていない `app_` のDB」が
出てこない。`` `app\_%` `` への GRANT OPTION を持つ `db_console_admin` で引く必要があり、
そのため自動登録は**管理ロールが設定されている環境でだけ動く**（未設定の本番VPSでは従来どおり
「既存DBを登録」からの手動登録になる）。LIKE の `_` はワイルドカードなのでエスケープする。

**`app_` のDBは「削除」しても行を消さない。** 消すと次の描画で自動登録が戻してしまうため、
`deleteDatabaseEntry()`（`src/lib/config.ts`）は `ManagedDatabase.excludedAt` に日時を入れて
「除外中」にする。除外中の行は `getDatabasesConfig()`・`getDatabaseEntry()` から外れる
（＝許可リストに載らない）が、`listAllManagedDatabaseNames()` には出るので自動登録の対象からも外れる。
戻すときは「既存DBを登録」から選び直すと `createDatabaseEntry()` が除外を解除する。
**除外しても `db_console_data` へ付与済みのGRANTは残る**（REVOKEの経路はこのアプリに無い）。
アプリからは触れなくなるが、権限まで剥がしたいときはMariaDB側の手作業になる。

**画面表示用の表示名（`ManagedDatabase.label`）は #97 で廃止した**——DB名をそのまま表示する。
表示名を復活させる変更はこの決定を覆すことになるので、Issueで相談する。

## アプリ名・アイコン

利用者に見せる名前とアイコンの一次情報源は `src/lib/app-branding.tsx`（`APP_NAME` / 配色 /
`AppIconGlyph`）。`layout.tsx`・`manifest.ts`・`icon.tsx`・`apple-icon.tsx`・`icons/[size]/route.tsx`・
ログイン画面はすべてここを参照する。**各ファイルへ名前や色を直接書かない。**
`db-console` はリポジトリ名・パッケージ名・PM2のプロセス名として使い続け、表示名だけ `DB Console`。

**アイコンのパスは `src/proxy.ts` の `matcher` から除外する。** 未ログインでも取得できないと、
ログイン画面のタブアイコンとホーム画面へ追加したときのアイコンが `/login` へのリダイレクトになる。
除外リストの `icon` は前方一致なので `/icons/*` も一緒に外れるが、`/apple-icon` は別途書く必要がある。

## 検証コマンド

**`typecheck` の npm script は無い。** CI（`.github/workflows/ci.yml`）は `npx tsc --noEmit` を直接
叩いている。**存在しないコマンドを探さず、下記を使うこと。**

| 目的 | コマンド |
|---|---|
| Lint | `npm run lint` |
| 型チェック | `npx tsc --noEmit` |
| テスト | `npm test`（vitest） |
| ビルド | 下記のとおり環境変数が要る |

**`npm test` はコンポーネントを描画できない。** `vitest.config.ts` は `environment: "node"`・
`include: ["tests/**/*.test.ts"]`（`.tsx` は対象外）で、`jsdom`・`@testing-library/react`・
`@vitejs/plugin-react` は devDependencies にあるだけで使われていない。描画を確かめたいときは、
`plugins: [react()]`・`environment: "jsdom"`・`.tsx` を含む一時の vitest 設定を作って
`npx vitest run --config <一時設定>` で実行する（**設定ファイルはリポジトリ内に置くこと。**
リポジトリ外に置くと `vitest/config` を解決できず起動に失敗する）。常設したい場合は
テスト設定そのものの変更になるため、その旨をIssueで相談する。

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
`uses:` で参照する薄い caller だけを置いている（現在は `@workflows/v25`）。**caller を追加・更新する
ときは、既存の caller と同じタグへ必ず揃える**（`uses:` と `prompts-ref` の両方）。

**タグは「どのジョブが存在するか」も固定する。** 参照先の共有ワークフローは issue-deck の `main` で
先に育つため、caller のトリガー（`on:`）を新しいジョブへ合わせて広げても、参照しているタグ時点に
そのジョブが無ければ何も起きない。「トリガーは足したのに動かない」ときは、まず
`gh api repos/guchi-apps/issue-deck/contents/.github/workflows/<reusable-*.yml>?ref=<タグ> --jq .content | base64 -d`
で、そのタグにジョブ本体が入っているかを確かめる（実例: guchi-apps/db-console#60）。

コンフリクトの自動解消（`claude-conflict-resolve.yml`）も同じ仕組みの caller で、develop向けPRが
`develop` とコンフリクトすると無人で解消を試みる。

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

**実装エージェントは `npm version` 系コマンドを実行せず、`package.json` の `version` と
更新履歴（`src/lib/changelog.ts`）を変更しない。** バンプPRのなかで `npm version` が
`scripts/version-changelog.mjs`（`"version"` lifecycle）を呼び、リリース差分から生成した
利用者向けの文面を `APP_CHANGELOG` の先頭へ挿入する。Issueごとに手で追記すると、
並行して進む他のIssueと必ずコンフリクトする。画面表示は設定画面の「アプリ情報」
（`src/components/changelog-dialog.tsx`）。

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

**このリポジトリは public である**（2026-08-18に private から変更。#49）。GitHub Actions の
標準ランナーぶんが課金対象外になるのが目的で、運用上は次の3点が変わっている。

- **Secret scanning と push protection が有効。** 実シークレットらしき文字列を含むコミットは
  push が拒否される。ダミー値をサンプルへ書くときも、実在するトークン形式（`ghp_` 等）を
  真似た文字列は使わない
- **Actions の成果物（`build-artifact`）とログは誰でもダウンロードできる。** ビルドへ
  シークレットを焼き込まない。クライアントバンドルへ入る `NEXT_PUBLIC_*` は公開前提の値だけにする
- **issue / PR の本文とコメントも全世界から読める。** 個人のメールアドレス・VPSの実IP・
  実パスワードを書かない。書いてしまった場合は編集ではなく削除する（編集履歴に原文が残るため）

**課金が外れたことを billing usage API の `netAmount` で判定してはいけない。** private でも
無料枠（3,000分/月）の範囲内なら `netAmount` は $0 になり、public 化の前後で値が変わらない。
`GET /organizations/<org>/settings/billing/usage` の結果から**現在 private なリポジトリぶんの
`Minutes` を合計**し、無料枠に対してどれだけ消費しているかで見る（#49）。
