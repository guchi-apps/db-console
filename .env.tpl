# db-console 自身のメタデータDB（app_db_console）。DB_NAMEのみアプリ固有、他は共通DBアイテムを参照
DB_NAME=op://apps/db-console/db-name
DB_USER=op://apps/DB/db-user
DB_PASSWORD=op://apps/DB/db-password
DB_HOST=op://apps/DB/db-host
DB_PORT=op://apps/DB/db-port
# DATABASE_URL は1Passwordに登録せず、scripts/construct-database-url.sh で組み立てる

# Google OAuth（本番用クライアント。開発用クライアントは.env.localに直接記載し1Passwordには登録しない）
GOOGLE_CLIENT_ID=op://apps/db-console/google-client-id
GOOGLE_CLIENT_SECRET=op://apps/db-console/google-client-secret

# NextAuth.js / Auth.js
AUTH_SECRET=op://apps/db-console/auth-secret
AUTH_URL=op://apps/db-console/auth-url

# ログイン許可メールアドレス（カンマ区切り、複数可）
ALLOWED_EMAILS=op://apps/db-console/allowed-emails

# 管理対象DBへの通常操作用ロール（M5でVPS側に作成。db_console_data 等）
DB_CONSOLE_DATA_USER=op://apps/db-console/db-console-data-user
DB_CONSOLE_DATA_PASSWORD=op://apps/db-console/db-console-data-password

# 管理対象DBへの構造変更用ロール（M5でVPS側に作成。db_console_schema 等）
DB_CONSOLE_SCHEMA_USER=op://apps/db-console/db-console-schema-user
DB_CONSOLE_SCHEMA_PASSWORD=op://apps/db-console/db-console-schema-password

# CI / デプロイ通知（Signaly）
SIGNALY_WEBHOOK_URL=op://apps/db-console/ci-webhook-url
