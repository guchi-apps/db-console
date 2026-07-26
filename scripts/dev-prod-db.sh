#!/usr/bin/env bash
# 開発サーバーを本番の管理対象DB（app_car等）に接続して起動する（データ確認用）。
# db-console自身のログイン・設定画面のDB一覧はローカルDBのまま変わらない。
#
# 使い方:
#   cp -n .env.op.example .env.op
#   op signin
#   npm run dev:prod-db
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env.op"
ENV_EXAMPLE="$ROOT/.env.op.example"
LOCAL_ENV="$ROOT/.env.local"

if ! command -v op >/dev/null 2>&1; then
  echo "Error: 1Password CLI (op) が見つかりません。" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE がありません。" >&2
  echo "  cp $ENV_EXAMPLE $ENV_FILE" >&2
  exit 1
fi

if [[ ! -f "$LOCAL_ENV" ]]; then
  echo "Error: $LOCAL_ENV がありません（npm run env:init を先に実行）。" >&2
  exit 1
fi

echo "" >&2
echo "⚠️  開発サーバーを本番の管理対象DB（app_car等）に接続して起動します。" >&2
echo "   レコードの追加・編集・削除・構造変更は本番データに反映されます。閲覧のみ推奨。" >&2
echo "   db-console自身のログイン・設定画面のDB一覧はローカルDBのままです。" >&2
echo "" >&2

exec op run --env-file="$ENV_FILE" -- bash "$ROOT/scripts/dev-prod-db-inner.sh"
