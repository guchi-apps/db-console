# db-console

スマートフォン向けMariaDB管理画面。Next.js App Router + Supabase Auth（Google認証）+ Prisma + mysql2で構成。
詳細な要件・実装計画は [issue #1](https://github.com/m-guchi/db-console/issues/1) / [issue #2](https://github.com/m-guchi/db-console/issues/2) を参照。

ログインには Supabase プロジェクト（複数アプリ共通、Google Provider を有効化したもの）が必要。
`.env.local` に `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` を設定し、
Supabaseダッシュボードの Authentication → URL Configuration の Redirect URLs に
`http://localhost:3000/auth/callback`（本番は `https://<ドメイン>/auth/callback`）を登録すること。

## セットアップ

```bash
npm install
npm run env:init      # .env.local を作成（値を編集）
npm run db:setup      # ローカルMariaDBにメタデータDB・管理対象DB（テスト用）・ロールを作成
npm run db:migrate    # Prismaマイグレーション
```

## 起動方法

用途に応じて2種類の起動方法がある。

### `npm run dev`（通常の開発）

ローカルの開発用DBに接続する。ログイン・設定画面のDB一覧・管理対象DB（`app_car` / `app_asset_manager` / `wordpress`のローカル版）すべてがローカル環境内で完結する。

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) で確認できる。

### `npm run dev:prod-db`（本番データ確認）

db-console自身のログイン・設定画面のDB一覧はローカルDBのまま、レコード一覧・SQL実行など**管理対象DBへの読み書きだけ**を本番（VPS）のデータに向けて起動する。1PasswordからSSH接続情報と`db_console_data` / `db_console_schema`の本番認証情報を取得し、SSHトンネル（`127.0.0.1:3307` → VPS `127.0.0.1:3306`）を自動で確立する。

```bash
cp -n .env.op.example .env.op   # 初回のみ
op signin
npm run dev:prod-db
```

> ⚠️ 起動中の追加・編集・削除・構造変更操作は実際の本番データに反映される。閲覧目的での利用を推奨。`Ctrl+C`で停止するとSSHトンネルも自動で閉じる。

### `npm run db:tunnel:prod`（DB接続のみ確認したい場合）

開発サーバーを起動せず、本番DBへのSSHトンネルだけを張る。別ターミナルで`mysql`クライアント等から直接接続確認したいときに使う。

```bash
npm run db:tunnel:prod
```

## テスト

```bash
npm run lint
npm test          # 単体テスト（Vitest）
npm run test:e2e  # E2E（Playwright）
```

## デプロイ

`main`ブランチへのpushで`.github/workflows/deploy.yml`が実行され、VPSへ自動デプロイされる（GitHub Actions + 1Password + PM2）。
