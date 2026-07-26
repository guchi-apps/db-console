import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      // lib/db.ts の PrismaClient 初期化（URLパースのみ、実接続はしない）に必要な
      // ダミー値。単体テストでは lib/config.ts の zod バリデーションのみを検証しており、
      // 実際にこのDBへ接続することはない。
      DATABASE_URL: "mysql://dummy:dummy@127.0.0.1:3306/dummy",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
