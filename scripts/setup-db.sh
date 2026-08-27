#!/usr/bin/env bash
# ローカル MySQL/MariaDB に db-console の開発環境を構築する（1Password 不要）。
#
# 使い方:
#   npm run db:setup
#
# 前提: sudo mysql で root 接続できること（MySQL 起動済み）。
#
# 作成するもの:
#   1. db-console 自身のメタデータDB（app_db_console）+ 専用ユーザー（Prisma用）
#   2. 管理対象DBのローカル版
#      - app_car: car-care自身のローカル開発DBと同名のため作成・データ投入はしない（既存データを読む）
#      - app_asset_manager / wordpress: ローカル専用のテスト用データを作成する（本番の同名DBとは別物）
#   3. 管理対象DBへの通常操作用/構造変更用ロール（db_console_data_dev / db_console_schema_dev）
#   4. DB作成・DBユーザー管理用ロール（db_console_admin_dev。app_ で始まるDB・ユーザー限定）

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"
ENV_EXAMPLE="$ROOT/.env.example"

escape_sql_string() {
  printf "%s" "$1" | sed "s/'/''/g"
}

validate_identifier() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo "Error: ${name} に使えない文字が含まれています（英数字・_・- のみ）: ${value}" >&2
    exit 1
  fi
}

run_setup() {
  for var in DB_NAME DB_USER DB_PASSWORD DB_CONSOLE_DATA_USER DB_CONSOLE_DATA_PASSWORD \
    DB_CONSOLE_SCHEMA_USER DB_CONSOLE_SCHEMA_PASSWORD \
    DB_CONSOLE_ADMIN_USER DB_CONSOLE_ADMIN_PASSWORD; do
    if [[ -z "${!var:-}" ]]; then
      echo "Error: ${var} が .env.local に設定されていません。" >&2
      exit 1
    fi
  done

  validate_identifier "DB_NAME" "$DB_NAME"
  validate_identifier "DB_USER" "$DB_USER"
  validate_identifier "DB_CONSOLE_DATA_USER" "$DB_CONSOLE_DATA_USER"
  validate_identifier "DB_CONSOLE_SCHEMA_USER" "$DB_CONSOLE_SCHEMA_USER"
  validate_identifier "DB_CONSOLE_ADMIN_USER" "$DB_CONSOLE_ADMIN_USER"

  local db_password_esc data_password_esc schema_password_esc admin_password_esc
  db_password_esc=$(escape_sql_string "$DB_PASSWORD")
  data_password_esc=$(escape_sql_string "$DB_CONSOLE_DATA_PASSWORD")
  schema_password_esc=$(escape_sql_string "$DB_CONSOLE_SCHEMA_PASSWORD")
  admin_password_esc=$(escape_sql_string "$DB_CONSOLE_ADMIN_PASSWORD")

  if ! command -v mysql >/dev/null 2>&1; then
    echo "Error: mysql コマンドが見つかりません。" >&2
    exit 1
  fi

  echo "セットアップ対象:"
  echo "  DB_NAME (メタデータDB): ${DB_NAME}"
  echo "  DB_USER: ${DB_USER}"
  echo "  DB_CONSOLE_DATA_USER: ${DB_CONSOLE_DATA_USER}"
  echo "  DB_CONSOLE_SCHEMA_USER: ${DB_CONSOLE_SCHEMA_USER}"
  echo "  DB_CONSOLE_ADMIN_USER: ${DB_CONSOLE_ADMIN_USER}"
  echo "  管理対象DB（ローカルテスト用）: app_car, app_asset_manager, wordpress"

  sudo mysql <<EOSQL
-- 1. db-console 自身のメタデータDB
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${db_password_esc}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${db_password_esc}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
GRANT CREATE, DROP, ALTER, INDEX, REFERENCES, SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES, LOCK TABLES ON *.* TO '${DB_USER}'@'localhost';

CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${db_password_esc}';
ALTER USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${db_password_esc}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';
GRANT CREATE, DROP, ALTER, INDEX, REFERENCES, SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES, LOCK TABLES ON *.* TO '${DB_USER}'@'127.0.0.1';

-- 2. 管理対象DBのローカルテスト用データ（本番とは別物）
-- app_car は car-care 自身のローカル開発DB（本物のVehicle等のテーブルを持つ）と同名のため、
-- ここでは作成・データ投入を行わない（既存のスキーマ・データをそのまま読み取り確認に使う）。
CREATE DATABASE IF NOT EXISTS \`app_car\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE DATABASE IF NOT EXISTS \`app_asset_manager\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS \`app_asset_manager\`.\`assets\` (
  id INT AUTO_INCREMENT PRIMARY KEY,
  label VARCHAR(100) NOT NULL,
  amount DECIMAL(12,2),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO \`app_asset_manager\`.\`assets\` (label, amount)
SELECT * FROM (SELECT 'テスト資産' AS l, 100000.00 AS a) AS tmp
WHERE NOT EXISTS (SELECT 1 FROM \`app_asset_manager\`.\`assets\`);

CREATE DATABASE IF NOT EXISTS \`wordpress\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS \`wordpress\`.\`wp_posts_sample\` (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_title VARCHAR(200) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO \`wordpress\`.\`wp_posts_sample\` (post_title)
SELECT * FROM (SELECT 'テスト投稿' AS t) AS tmp
WHERE NOT EXISTS (SELECT 1 FROM \`wordpress\`.\`wp_posts_sample\`);

-- 3. 管理対象DBへの通常操作用ロール（db_console_data 相当）
--    SHOW VIEW は information_schema.views.view_definition（ビュー定義の表示）に必要。
--    無くてもエラーにはならず定義が空文字で返るだけなので、権限が無い環境でも画面は動く。
CREATE USER IF NOT EXISTS '${DB_CONSOLE_DATA_USER}'@'localhost' IDENTIFIED BY '${data_password_esc}';
ALTER USER '${DB_CONSOLE_DATA_USER}'@'localhost' IDENTIFIED BY '${data_password_esc}';
GRANT SELECT, INSERT, UPDATE, DELETE, SHOW VIEW ON \`app_car\`.* TO '${DB_CONSOLE_DATA_USER}'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, SHOW VIEW ON \`app_asset_manager\`.* TO '${DB_CONSOLE_DATA_USER}'@'localhost';
GRANT SELECT, SHOW VIEW ON \`wordpress\`.* TO '${DB_CONSOLE_DATA_USER}'@'localhost';

-- 4. 管理対象DBへの構造変更用ロール（db_console_schema 相当。schema-writeのapp_asset_managerのみ）
CREATE USER IF NOT EXISTS '${DB_CONSOLE_SCHEMA_USER}'@'localhost' IDENTIFIED BY '${schema_password_esc}';
ALTER USER '${DB_CONSOLE_SCHEMA_USER}'@'localhost' IDENTIFIED BY '${schema_password_esc}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, SHOW VIEW ON \`app_asset_manager\`.* TO '${DB_CONSOLE_SCHEMA_USER}'@'localhost';

-- 5. DB作成・DBユーザー管理用ロール（db_console_admin 相当。#91）
--    権限が効く範囲を app_ で始まるDBに絞るため、DB名のパターン指定でGRANTする
--    （\`app\_%\` の \_ はワイルドカードではなくリテラルの _ を意味する）。
--    CREATE USER はグローバルにしか付けられないが、アプリ側は app_ で始まる
--    ユーザー名だけを扱う（src/lib/db-users.ts の assertSafeUserName）。
--    mysql.user / mysql.db の SELECT は、既存アカウントとその権限の一覧表示に必要。
CREATE USER IF NOT EXISTS '${DB_CONSOLE_ADMIN_USER}'@'localhost' IDENTIFIED BY '${admin_password_esc}';
ALTER USER '${DB_CONSOLE_ADMIN_USER}'@'localhost' IDENTIFIED BY '${admin_password_esc}';
GRANT ALL PRIVILEGES ON \`app\_%\`.* TO '${DB_CONSOLE_ADMIN_USER}'@'localhost' WITH GRANT OPTION;
GRANT CREATE USER ON *.* TO '${DB_CONSOLE_ADMIN_USER}'@'localhost';
GRANT SELECT ON mysql.user TO '${DB_CONSOLE_ADMIN_USER}'@'localhost';
GRANT SELECT ON mysql.db TO '${DB_CONSOLE_ADMIN_USER}'@'localhost';

FLUSH PRIVILEGES;
EOSQL

  echo "接続確認中..."
  if mysql -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "SELECT 1" >/dev/null 2>&1; then
    echo "OK: メタデータDB・ユーザー作成完了（.env.local の認証情報と一致）"
  else
    echo "Error: DB_USER/DB_PASSWORD で app_db_console に接続できません。" >&2
    exit 1
  fi

  if mysql -u "$DB_CONSOLE_DATA_USER" -p"$DB_CONSOLE_DATA_PASSWORD" app_car -e "SELECT 1" >/dev/null 2>&1; then
    echo "OK: db_console_data ロールで app_car に接続できました"
  else
    echo "Error: DB_CONSOLE_DATA_USER/PASSWORD で app_car に接続できません。" >&2
    exit 1
  fi

  if mysql -u "$DB_CONSOLE_ADMIN_USER" -p"$DB_CONSOLE_ADMIN_PASSWORD" \
    -e "SELECT User FROM mysql.user LIMIT 1" >/dev/null 2>&1; then
    echo "OK: db_console_admin ロールで mysql.user を参照できました"
  else
    echo "Error: DB_CONSOLE_ADMIN_USER/PASSWORD で mysql.user を参照できません。" >&2
    exit 1
  fi

  echo "次: npm run db:migrate （Prisma マイグレーション）"
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE がありません。" >&2
  echo "  cp $ENV_EXAMPLE $ENV_FILE" >&2
  echo "  作成後、DB_NAME/DB_USER/DB_PASSWORD/DB_CONSOLE_*_USER/PASSWORD 等を編集してください。" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

run_setup
