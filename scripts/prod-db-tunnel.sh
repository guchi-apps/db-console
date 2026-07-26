#!/usr/bin/env bash
# VPS 上の MariaDB（127.0.0.1 待受）へ SSH トンネルを張る
#
# 使い方:
#   op signin
#   npm run db:tunnel:prod          # このターミナルでトンネル維持
#   # 別ターミナルで mysql -h127.0.0.1 -P3307 -u... のように接続確認
#
# 1Password（.env.op）に SSH_HOST / SSH_USER / SSH_PORT を登録してください。
# VPS 認証は GitHub Actions と同じ SSH_PRIVATE_KEY（githubaction-sshkey）を推奨。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env.op"
ENV_EXAMPLE="$ROOT/.env.op.example"

LOCAL_PORT="${PROD_DB_LOCAL_PORT:-3307}"
REMOTE_PORT="${PROD_DB_REMOTE_PORT:-3306}"

if ! command -v op >/dev/null 2>&1; then
  echo "Error: 1Password CLI (op) が見つかりません。" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE がありません。" >&2
  echo "  cp $ENV_EXAMPLE $ENV_FILE" >&2
  exit 1
fi

if command -v ss >/dev/null 2>&1 && ss -tln | grep -q ":${LOCAL_PORT} "; then
  echo "ポート ${LOCAL_PORT} は既に使用中です（トンネル起動済みの可能性）。" >&2
  exit 0
fi

echo "SSH トンネル: localhost:${LOCAL_PORT} → VPS:127.0.0.1:${REMOTE_PORT}"
echo "停止: Ctrl+C"
echo ""

exec op run --env-file="$ENV_FILE" -- bash -c '
  : "${SSH_HOST:?SSH_HOST が未設定です。.env.op に SSH_HOST を追加してください}"
  : "${SSH_USER:?SSH_USER が未設定です。.env.op に SSH_USER を追加してください}"

  SSH_PORT="${SSH_PORT:-22}"
  LOCAL_PORT="${PROD_DB_LOCAL_PORT:-3307}"
  REMOTE_PORT="${PROD_DB_REMOTE_PORT:-3306}"

  SSH_KEY_FILE=""
  cleanup() {
    if [[ -n "$SSH_KEY_FILE" && -f "$SSH_KEY_FILE" ]]; then
      rm -f "$SSH_KEY_FILE"
    fi
  }
  trap cleanup EXIT INT TERM

  SSH_OPTS=(
    -o ExitOnForwardFailure=yes
    -o ServerAliveInterval=60
    -o BatchMode=yes
  )

  if [[ -n "${SSH_PRIVATE_KEY:-}" ]]; then
    SSH_KEY_FILE="$(mktemp)"
    chmod 600 "$SSH_KEY_FILE"
    printf "%s\n" "$SSH_PRIVATE_KEY" > "$SSH_KEY_FILE"
    SSH_OPTS+=(-i "$SSH_KEY_FILE" -o IdentitiesOnly=yes)
  fi

  exec ssh -N "${SSH_OPTS[@]}" \
    -p "$SSH_PORT" \
    -L "127.0.0.1:${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}" \
    "${SSH_USER}@${SSH_HOST}"
'
