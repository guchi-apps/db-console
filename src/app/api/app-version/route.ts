import { NextResponse } from "next/server";

import { APP_VERSION } from "@/lib/app-version";

// CDN/ブラウザにキャッシュされると稼働中の版を取り違えるため常に無効化する。
export const dynamic = "force-dynamic";

/**
 * 稼働しているアプリの版とコミットの SHA（#220）。`sha` は `deploy.yml` が `.env` へ書く
 * `APP_COMMIT_SHA` をそのまま返す。デプロイのヘルスチェックはこれが今回のコミットと一致するまで
 * 成功にしない（旧版が HTTP 200 を返しているだけの状態を成功と見なさないため）。
 *
 * 未ログインで取れる経路（`src/lib/public-paths.ts`）なので、返すのは公開情報である版と SHA だけにする。
 * DB・接続先・利用者に関わる値をここへ足さないこと。ローカル開発など未設定なら `sha` は null。
 */
export async function GET() {
  return NextResponse.json(
    { version: APP_VERSION, sha: process.env.APP_COMMIT_SHA || null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
