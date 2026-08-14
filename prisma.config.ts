import { defineConfig } from "@prisma/config";

// `env("DATABASE_URL")` は未設定だと config の読み込み自体が失敗する。**その結果、
// postinstall の `prisma generate` が落ちて `npm ci` ごと失敗する**ため、DATABASE_URL を
// 用意できない環境ではクローン直後の依存インストールが通らない（GitHub Actions の
// 無人実行がまさにこれで、共有ワークフローの `npm ci` ステップは DATABASE_URL を渡さない）。
//
// `prisma generate` はDBへ接続しないので、その用途ではURLの中身は要らない。未設定のときだけ
// 接続できないプレースホルダーへ倒す。**実在のDBへ黙って向かわないよう、存在しないDB名にする**——
// `migrate` 等の実際に接続するコマンドは、設定漏れのまま成功せず接続エラーで落ちる。
// 同じ扱いは car-care・clip-hive・dayspan でも取っている（DATABASE_URL 未設定でも
// `prisma generate` が通る）。
const PLACEHOLDER_DATABASE_URL =
  "mysql://placeholder:placeholder@127.0.0.1:3306/db_console_placeholder";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL?.trim() || PLACEHOLDER_DATABASE_URL,
  },
});
