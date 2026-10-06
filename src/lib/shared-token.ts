/**
 * issue-deck の共有トークンAPI（guchi-apps/issue-deck の docs/shared-token-api.md）から、
 * アプリ間の認証値・外部APIキーを実行時に読む（issue #860）。1Passwordから各アプリへ値を複製せず、
 * issue-deck を唯一の正にする。ops-dashboard の `src/lib/shared-token.ts` と同じ形。
 *
 * `SHARED_TOKEN_API_SECRET` と `ISSUE_DECK_URL` が両方揃っていない環境（worktree・移行前）では
 * 取得を試みず、呼び出し元が環境変数へフォールバックする。トークン値と Bearer の値はログに出さない。
 */

const CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5_000;
const CONSUMER = "db-console";

export type SharedTokenCacheEntry = { value: string; fetchedAtMs: number };

export type SharedTokenResult = {
  /**
   * 1. キャッシュが新しければそれ 2. issue-deck から取得できればそれ
   * 3. 取得に失敗・未設定なら古くても直前のキャッシュ値 4. 無ければ null（環境変数へフォールバック）
   */
  value: string | null;
  cache: SharedTokenCacheEntry | null;
};

/** 副作用（キャッシュの保持）を関数の外へ出して、テストで単体に動かせるようにしている。 */
export async function resolveSharedToken(
  name: string,
  previous: SharedTokenCacheEntry | null,
  options: { now?: number } = {},
): Promise<SharedTokenResult> {
  const now = options.now ?? Date.now();

  if (previous && now - previous.fetchedAtMs < CACHE_MS) {
    return { value: previous.value, cache: previous };
  }

  const baseUrl = process.env.ISSUE_DECK_URL;
  const secret = process.env.SHARED_TOKEN_API_SECRET;
  if (!baseUrl || !secret) {
    return { value: previous?.value ?? null, cache: previous };
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/shared-tokens?name=${encodeURIComponent(name)}`, {
      headers: {
        authorization: `Bearer ${secret}`,
        "x-shared-token-consumer": CONSUMER,
        accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = (await response.json()) as unknown;
    const value = typeof payload === "object" && payload !== null ? (payload as { value?: unknown }).value : undefined;
    if (typeof value !== "string" || value === "") throw new SyntaxError("unexpected payload");

    return { value, cache: { value, fetchedAtMs: now } };
  } catch (error) {
    console.error(`[db-console] shared token fetch failed (${name}):`, error instanceof Error ? error.message : error);
    return { value: previous?.value ?? null, cache: previous };
  }
}

const caches = new Map<string, SharedTokenCacheEntry>();
// 同時に来た要求で issue-deck を何度も叩かない（利用記録も1件ずつ増えるため）。
const inFlight = new Map<string, Promise<string | null>>();

/**
 * 共有トークン `name` の値を返す。取得できなければ環境変数 `fallbackEnvName` の値、それも無ければ undefined。
 * 未設定を認証なしに化けさせないため、呼び出し側は undefined を「未設定」として扱うこと。
 */
export async function getSharedToken(name: string, fallbackEnvName: string): Promise<string | undefined> {
  let pending = inFlight.get(name);
  if (!pending) {
    pending = resolveSharedToken(name, caches.get(name) ?? null)
      .then((result) => {
        if (result.cache) caches.set(name, result.cache);
        return result.value;
      })
      .finally(() => inFlight.delete(name));
    inFlight.set(name, pending);
  }
  const value = await pending;
  return value ?? (process.env[fallbackEnvName] || undefined);
}

/** 1つの名前のキャッシュだけ捨てる。再発行で失効した値を握り続けないために、認証の401で呼ぶ。 */
export function forgetSharedToken(name: string): void {
  caches.delete(name);
}

/** テスト用：保持しているキャッシュを空にする。 */
export function resetSharedTokenCache(): void {
  caches.clear();
  inFlight.clear();
}
