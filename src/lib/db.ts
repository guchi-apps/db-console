import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

// Next.js の開発サーバーは HMR のたびにモジュールを再評価するため、
// グローバルにキャッシュしてコネクションプールの再生成を防ぐ（db-console 自身のメタデータDB専用）。
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// @prisma/adapter-mariadb@7.9.0 に接続文字列（string）をそのまま渡すと、内部で
// ConnectionOptions が正しく組み立てられず `Cannot read properties of undefined
// (reading 'prepareCacheLength')` で落ちる（mariadb@3.4.5 との組み合わせで確認）。
// そのため DATABASE_URL は自前でパースし、設定オブジェクトとして渡す。
function parseDatabaseUrl(databaseUrl: string) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
  };
}

function createPrismaClient() {
  const adapter = new PrismaMariaDb(parseDatabaseUrl(process.env.DATABASE_URL!));
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
