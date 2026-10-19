# db-console 自身のメタデータDB（app_db_console）。DB_NAMEのみアプリ固有、他は共通DBアイテムを参照
DB_NAME=op://apps/db-console/db-name
DB_USER=op://apps/DB/db-user
DB_PASSWORD=op://apps/DB/db-password
DB_HOST=op://apps/DB/db-host
DB_PORT=op://apps/DB/db-port
# DATABASE_URL は1Passwordに登録せず、scripts/construct-database-url.sh で組み立てる

# Supabase Auth（複数アプリ共通のプロジェクト。Google Providerの設定はSupabaseダッシュボード側で行う。
# Publishable keyはフロントに公開してよい値。Secret keyはこのアプリでは使用しない）
NEXT_PUBLIC_SUPABASE_URL=op://apps/Supabase/project-url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=op://apps/Supabase/publishable-key

# 管理対象DBへの通常操作用ロール（M5でVPS側に作成。db_console_data 等）
DB_CONSOLE_DATA_USER=op://apps/db-console/db-console-data-user
DB_CONSOLE_DATA_PASSWORD=op://apps/db-console/db-console-data-password

# 管理対象DBへの構造変更用ロール（M5でVPS側に作成。db_console_schema 等）
DB_CONSOLE_SCHEMA_USER=op://apps/db-console/db-console-schema-user
DB_CONSOLE_SCHEMA_PASSWORD=op://apps/db-console/db-console-schema-password

# DB作成・DBユーザー管理用ロール（#91でVPS側に作成。db_console_admin 等）
# 1Passwordに同名フィールドが2組あるため、本番 .env と一致する組（表示名なしのセクション）をフィールドIDで指す（#228）。
# vrrgy557… = db-console-admin-user、k24sfi5h… = db-console-admin-password
DB_CONSOLE_ADMIN_USER=op://apps/db-console/vrrgy557vmw57tfx7pmazpluzm
DB_CONSOLE_ADMIN_PASSWORD=op://apps/db-console/k24sfi5hwt3h7v6oldjzu2e7qy

# CI / デプロイ通知（Signaly）
SIGNALY_WEBHOOK_URL=op://apps/Notify/ci-webhook-url
