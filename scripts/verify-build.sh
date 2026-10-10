#!/usr/bin/env bash
# リリース検証（サブPC）用: 使い捨てのMySQLを起動して `prisma migrate deploy` と `npm run build` を通す。
#
# CI（.github/workflows/ci.yml）のビルドは MariaDB へ migrate deploy してから build する。
# サブPCには共有のDB接続情報が無いため、サブPCに入っている mysqld を一時ディレクトリで
# 起動し、終了時に必ず止めて消す。**常駐DB・実シークレットには一切触れない**
# （ルートは認証なし・127.0.0.1の空きポートのみ・接続情報はこのスクリプトの中だけに存在する）。
#
# 使い方（リポジトリのルートで）: bash scripts/verify-build.sh
# 前提: `mysqld` が PATH か /usr/sbin にあること。root権限・sudoは不要。
#
# 注意: 本番・CIは MariaDB 10.11、サブPCは MySQL 8.0 のため、マイグレーションの適用可否は
# 検証できるが MariaDB 固有の差異までは保証しない。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MYSQLD="$(command -v mysqld || true)"
[[ -z "$MYSQLD" && -x /usr/sbin/mysqld ]] && MYSQLD=/usr/sbin/mysqld
if [[ -z "$MYSQLD" ]]; then
  echo "Error: mysqld が見つかりません。検証用DBを起動できないためビルドを検証できません。" >&2
  exit 1
fi
if ! command -v mysql >/dev/null 2>&1; then
  echo "Error: mysql クライアントが見つかりません。" >&2
  exit 1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/db-console-verify.XXXXXX")"
SOCKET="$WORK/mysqld.sock"
MYSQLD_PID=""

cleanup() {
  if [[ -n "$MYSQLD_PID" ]] && kill -0 "$MYSQLD_PID" 2>/dev/null; then
    kill "$MYSQLD_PID" 2>/dev/null || true
    # 終了を待つ（データディレクトリを消す前に止める）
    for _ in $(seq 1 30); do
      kill -0 "$MYSQLD_PID" 2>/dev/null || break
      sleep 1
    done
    kill -9 "$MYSQLD_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# 空きポートを選ぶ（固定ポートだと同時実行・常駐DBと衝突する）
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"

echo "==> 検証用DBを初期化します（127.0.0.1:${PORT}）"
"$MYSQLD" --no-defaults --initialize-insecure --datadir="$WORK/data" \
  --log-error="$WORK/init.log" >/dev/null 2>&1 || {
  echo "Error: mysqld の初期化に失敗しました。" >&2
  tail -n 20 "$WORK/init.log" >&2 || true
  exit 1
}

"$MYSQLD" --no-defaults --datadir="$WORK/data" --socket="$SOCKET" \
  --bind-address=127.0.0.1 --port="$PORT" --mysqlx=OFF \
  --pid-file="$WORK/mysqld.pid" --log-error="$WORK/mysqld.log" >/dev/null 2>&1 &
MYSQLD_PID=$!

for _ in $(seq 1 60); do
  mysql --no-defaults -uroot --socket="$SOCKET" -e 'SELECT 1' >/dev/null 2>&1 && break
  if ! kill -0 "$MYSQLD_PID" 2>/dev/null; then
    echo "Error: mysqld が起動直後に終了しました。" >&2
    tail -n 20 "$WORK/mysqld.log" >&2 || true
    exit 1
  fi
  sleep 1
done
mysql --no-defaults -uroot --socket="$SOCKET" -e 'SELECT 1' >/dev/null 2>&1 || {
  echo "Error: 検証用DBへ接続できません。" >&2
  exit 1
}

mysql --no-defaults -uroot --socket="$SOCKET" -e 'CREATE DATABASE db_console_test'

# ci.yml の env と同じプレースホルダー（実シークレットではない）
export DATABASE_URL="mysql://root@127.0.0.1:${PORT}/db_console_test"
export NEXT_PUBLIC_SUPABASE_URL=https://dummy-project.supabase.co
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy-publishable-key-for-ci-only
export DB_HOST=127.0.0.1
export DB_PORT="$PORT"
export DB_CONSOLE_DATA_USER=dummy
export DB_CONSOLE_DATA_PASSWORD=dummy
export DB_CONSOLE_SCHEMA_USER=dummy
export DB_CONSOLE_SCHEMA_PASSWORD=dummy
export CHECKPOINT_DISABLE=1

echo "==> prisma migrate deploy"
npx prisma migrate deploy

echo "==> npm run build"
npm run build
