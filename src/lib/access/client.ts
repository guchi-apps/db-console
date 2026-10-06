import { forgetSharedToken, getSharedToken } from "@/lib/shared-token";
import {
  createAccessClient,
  parseAccessResponse,
  type AccessDecision,
  type AccessFetcher,
  type AccessSubject,
} from "@/lib/access/decision";

const TIMEOUT_MS = 5_000;

const TOKEN_NAME = "DB_CONSOLE_ACCESS_APP_TOKEN";
/** StatusHub の本番オリジン。`ACCESS_API_URL` は開発などで別の宛先へ向けるときだけ使う。 */
const DEFAULT_ACCESS_API_URL = "https://admin.gucchii.com";

/**
 * StatusHub の判定APIを呼ぶ。管理画面の「トークン発行」が
 * issue-deck の共有トークン `DB_CONSOLE_ACCESS_APP_TOKEN` へ自動で書き込んだアプリ別トークンが
 * 無ければ、通信せず失敗として扱う＝一度も判定できないので全員拒否になる（未設定が「誰でも通す」に化けない）。
 * トークンは issue-deck から読み、1Password・GitHub Secrets・デプロイを経由しない。
 * 再発行で古いトークンは即失効するため、401ならキャッシュを捨てて読み直し、1回だけ再試行する。
 * トークンの値はログへ出さない。
 */
async function post(baseUrl: string, token: string, body: Parameters<AccessFetcher>[0]): Promise<Response> {
  return fetch(`${baseUrl.replace(/\/+$/, "")}/api/access/v1/decision`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

const fetcher: AccessFetcher = async (body) => {
  const baseUrl = process.env.ACCESS_API_URL || DEFAULT_ACCESS_API_URL;
  const token = await getSharedToken(TOKEN_NAME, "ACCESS_APP_TOKEN");
  if (!token) throw new Error(`${TOKEN_NAME} が未設定`);

  let response = await post(baseUrl, token, body);
  if (response.status === 401) {
    forgetSharedToken(TOKEN_NAME);
    const renewed = await getSharedToken(TOKEN_NAME, "ACCESS_APP_TOKEN");
    if (renewed && renewed !== token) response = await post(baseUrl, renewed, body);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseAccessResponse(await response.json(), body.subject !== undefined);
};

// 開発サーバーの再読み込みで状態が消えないよう globalThis に置く（instrumentation と route が同じ状態を見る）。
const globalForAccess = globalThis as unknown as { __dbConsoleAccess?: ReturnType<typeof createAccessClient> };

function client() {
  globalForAccess.__dbConsoleAccess ??= createAccessClient(fetcher, undefined, Date.now, (error) => {
    console.error("[db-console] アクセス判定の取得に失敗:", error instanceof Error ? error.message : error);
  });
  return globalForAccess.__dbConsoleAccess;
}

/**
 * `getClaims()` の検証済みクレームから許可を判定する（ブラウザの申告ではなく、署名検証済みのJWTの値だけを使う）。
 * メールが確認済みかは `user_metadata.email_verified`（Googleの email_verified）から決める。
 */
export async function isClaimsAllowed(claims: {
  sub: string;
  email?: string;
  user_metadata?: { email_verified?: unknown };
}): Promise<boolean> {
  if (!claims.email) return false;
  const subject: AccessSubject = {
    sub: claims.sub,
    email: claims.email,
    emailVerified: claims.user_metadata?.email_verified === true,
  };
  return (await decideAccess(subject)).allowed;
}

export async function decideAccess(subject: AccessSubject): Promise<AccessDecision> {
  return client().decide(subject);
}

export async function sendAccessHeartbeat(): Promise<boolean> {
  return client().heartbeat();
}
