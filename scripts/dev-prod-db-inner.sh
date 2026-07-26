#!/usr/bin/env bash
# scripts/dev-prod-db.sh から `op run` 経由で呼ばれる内部スクリプト。
# 1Passwordの値（SSH_HOST/SSH_USER/SSH_PORT/SSH_PRIVATE_KEY/DB_CONSOLE_DATA_*/DB_CONSOLE_SCHEMA_*）が
# 既に環境変数として渡ってきている前提。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

: "${SSH_HOST:?SSH_HOST が未設定です（.env.op を確認してください）}"
: "${SSH_USER:?SSH_USER が未設定です（.env.op を確認してください）}"
: "${DB_CONSOLE_DATA_USER:?DB_CONSOLE_DATA_USER が未設定です（.env.op を確認してください）}"
: "${DB_CONSOLE_SCHEMA_USER:?DB_CONSOLE_SCHEMA_USER が未設定です（.env.op を確認してください）}"

SSH_PORT="${SSH_PORT:-22}"
LOCAL_PORT="${PROD_DB_LOCAL_PORT:-3307}"
REMOTE_PORT="${PROD_DB_REMOTE_PORT:-3306}"

SSH_KEY_FILE=""
TUNNEL_PID=""
cleanup() {
  if [[ -n "$TUNNEL_PID" ]]; then
    kill "$TUNNEL_PID" 2>/dev/null || true
  fi
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
  printf "%s\n" "$SSH_PRIVATE_KEY" >"$SSH_KEY_FILE"
  SSH_OPTS+=(-i "$SSH_KEY_FILE" -o IdentitiesOnly=yes)
fi

if command -v ss >/dev/null 2>&1 && ss -tln | grep -q ":${LOCAL_PORT} "; then
  echo "ポート ${LOCAL_PORT} は既に使用中です（トンネル起動済みとみなして再利用します）" >&2
else
  echo "SSHトンネル起動中: 127.0.0.1:${LOCAL_PORT} → VPS:127.0.0.1:${REMOTE_PORT}" >&2
  ssh -N "${SSH_OPTS[@]}" \
    -p "$SSH_PORT" \
    -L "127.0.0.1:${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}" \
    "${SSH_USER}@${SSH_HOST}" &
  TUNNEL_PID=$!

  echo "トンネル接続確認中..." >&2
  connected=false
  for _ in $(seq 1 20); do
    if (exec 3<>"/dev/tcp/127.0.0.1/${LOCAL_PORT}") 2>/dev/null; then
      exec 3>&-
      connected=true
      break
    fi
    sleep 0.5
  done
  if [[ "$connected" != "true" ]]; then
    echo "Error: SSHトンネルが確立できませんでした。" >&2
    exit 1
  fi
  echo "トンネル接続OK" >&2
fi

# op run から渡ってきた本番のロール認証情報を退避しておく（.env.local読み込みで上書きされる前に）。
PROD_DB_CONSOLE_DATA_USER="$DB_CONSOLE_DATA_USER"
PROD_DB_CONSOLE_DATA_PASSWORD="$DB_CONSOLE_DATA_PASSWORD"
PROD_DB_CONSOLE_SCHEMA_USER="$DB_CONSOLE_SCHEMA_USER"
PROD_DB_CONSOLE_SCHEMA_PASSWORD="$DB_CONSOLE_SCHEMA_PASSWORD"

# db-console自身のメタデータDB（ログイン・設定画面）はローカルDBのままにするため、
# .env.local を読み込む（DB_USER/DB_PASSWORD/DB_HOST/DB_PORT/DB_NAME等）。
# .env.local にも開発用の DB_CONSOLE_DATA_USER 等が含まれここで一旦上書きされるが、
# 直後に退避しておいた本番の値へ戻す。
set -a
# shellcheck source=/dev/null
source "$ROOT/.env.local"
set +a

export TARGET_DB_HOST=127.0.0.1
export TARGET_DB_PORT="$LOCAL_PORT"
export DB_CONSOLE_DATA_USER="$PROD_DB_CONSOLE_DATA_USER"
export DB_CONSOLE_DATA_PASSWORD="$PROD_DB_CONSOLE_DATA_PASSWORD"
export DB_CONSOLE_SCHEMA_USER="$PROD_DB_CONSOLE_SCHEMA_USER"
export DB_CONSOLE_SCHEMA_PASSWORD="$PROD_DB_CONSOLE_SCHEMA_PASSWORD"

cd "$ROOT"
exec bash scripts/construct-database-url.sh next dev
