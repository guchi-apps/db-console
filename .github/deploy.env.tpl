# Vault: apps — db-console / DB / Server / githubaction-sshkey
SSH_PRIVATE_KEY=op://apps/githubaction-sshkey/private_key?ssh-format=openssh
HOST=op://apps/Server/host
USERNAME=op://apps/Server/username
SSH_PORT=op://apps/Server/ssh-port
TARGET_DIR=op://apps/db-console/target-dir
PORT=op://apps/db-console/port

# Database（ホスト・認証は共通DB、アプリ名のみ個別）
DB_USER=op://apps/DB/db-user
DB_PASSWORD=op://apps/DB/db-password
DB_HOST=op://apps/DB/db-host
DB_PORT=op://apps/DB/db-port
DB_NAME=op://apps/db-console/db-name
MIGRATE_DB_USER=op://apps/DB/migrate-user
MIGRATE_DB_PASSWORD=op://apps/DB/migrate-password

# Auth / App（Supabaseは複数アプリ共通プロジェクトのため Vault は共有アイテムを参照）
NEXT_PUBLIC_SUPABASE_URL=op://apps/Supabase/project-url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=op://apps/Supabase/publishable-key
ALLOWED_EMAILS=op://apps/db-console/allowed-emails

# 管理対象DBへのロール（VPS側で作成するdb_console_data/db_console_schema）
DB_CONSOLE_DATA_USER=op://apps/db-console/db-console-data-user
DB_CONSOLE_DATA_PASSWORD=op://apps/db-console/db-console-data-password
DB_CONSOLE_SCHEMA_USER=op://apps/db-console/db-console-schema-user
DB_CONSOLE_SCHEMA_PASSWORD=op://apps/db-console/db-console-schema-password

# CI / デプロイ通知
SIGNALY_WEBHOOK_URL=op://apps/db-console/ci-webhook-url
