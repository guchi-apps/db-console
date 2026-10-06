/**
 * StatusHub 共通アクセス設定の判定API（guchi-apps/status-hub の docs/access-control.md）のクライアント。
 *
 * 契約:
 * - 結果は `ttlSeconds` だけ使い回す
 * - 取得に失敗したときは、直前に取得できた判定を `maxStaleSeconds` まで使う。超えたら拒否する
 * - 一度も判定できていない利用者は拒否する（許可を広げない）
 * - 旧環境変数（ALLOWED_EMAILS）はフォールバックにしない
 *
 * 副作用（時計・通信・キャッシュ）は引数で受け、`node --test` で単体に動かせるようにしている。
 */

export type AccessSubject = { sub: string; email: string; emailVerified: boolean };

export type AccessDecision = { allowed: boolean; permissions: string[]; reason?: string };

export type AccessResponse = {
  appVersion: number;
  ttlSeconds: number;
  maxStaleSeconds: number;
  decision?: AccessDecision;
};

export type CacheEntry = { decision: AccessDecision; fetchedAtMs: number; ttlMs: number; maxStaleMs: number };

export type AccessFetcher = (body: {
  appliedVersion?: number;
  subject?: AccessSubject;
}) => Promise<AccessResponse>;

export const DENY: AccessDecision = { allowed: false, permissions: [], reason: "unavailable" };

export function cacheKey(subject: AccessSubject): string {
  return `${subject.sub}\n${subject.email.toLowerCase()}`;
}

/** 応答の形を確かめる。形が違えば投げ、失敗として扱わせる。 */
export function parseAccessResponse(payload: unknown, expectDecision: boolean): AccessResponse {
  if (typeof payload !== "object" || payload === null) throw new SyntaxError("unexpected payload");
  const p = payload as Record<string, unknown>;
  const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (!positive(p.appVersion) || !positive(p.ttlSeconds) || !positive(p.maxStaleSeconds)) {
    throw new SyntaxError("unexpected payload");
  }
  let decision: AccessDecision | undefined;
  if (expectDecision) {
    const d = p.decision as Record<string, unknown> | undefined;
    if (!d || typeof d.allowed !== "boolean") throw new SyntaxError("unexpected payload");
    const permissions = Array.isArray(d.permissions) ? d.permissions.filter((x): x is string => typeof x === "string") : [];
    decision = {
      allowed: d.allowed,
      permissions: d.allowed ? permissions : [],
      reason: typeof d.reason === "string" ? d.reason : undefined,
    };
  }
  return { appVersion: p.appVersion, ttlSeconds: p.ttlSeconds, maxStaleSeconds: p.maxStaleSeconds, decision };
}

export type AccessClientState = {
  cache: Map<string, CacheEntry>;
  inFlight: Map<string, Promise<AccessDecision>>;
  appliedVersion: number | undefined;
  /** 直近の応答が示した上限。判定を一度も取れていない利用者には使わない。 */
  lastHeartbeatAtMs: number;
};

export function createAccessState(): AccessClientState {
  return { cache: new Map(), inFlight: new Map(), appliedVersion: undefined, lastHeartbeatAtMs: 0 };
}

export function createAccessClient(
  fetcher: AccessFetcher,
  state: AccessClientState = createAccessState(),
  now: () => number = Date.now,
  onError: (error: unknown) => void = () => {},
) {
  async function decide(subject: AccessSubject): Promise<AccessDecision> {
    // 検証済みでないIDは問い合わせず拒否する（契約でも unverified_identity）。
    if (!subject.sub || !subject.email || !subject.emailVerified) {
      return { allowed: false, permissions: [], reason: "unverified_identity" };
    }
    const key = cacheKey(subject);
    const cached = state.cache.get(key);
    if (cached && now() - cached.fetchedAtMs < cached.ttlMs) return cached.decision;

    const pending = state.inFlight.get(key);
    if (pending) return pending;

    const request = (async (): Promise<AccessDecision> => {
      try {
        const response = await fetcher({ appliedVersion: state.appliedVersion, subject });
        if (!response.decision) throw new SyntaxError("missing decision");
        const at = now();
        state.appliedVersion = response.appVersion;
        state.lastHeartbeatAtMs = at;
        state.cache.set(key, {
          decision: response.decision,
          fetchedAtMs: at,
          ttlMs: response.ttlSeconds * 1000,
          maxStaleMs: response.maxStaleSeconds * 1000,
        });
        return response.decision;
      } catch (error) {
        onError(error);
        // 直前の判定を、取得できた時刻から maxStale まで。超えたら（または無ければ）拒否。
        if (cached && now() - cached.fetchedAtMs <= cached.maxStaleMs) return cached.decision;
        return DENY;
      } finally {
        state.inFlight.delete(key);
      }
    })();
    state.inFlight.set(key, request);
    return request;
  }

  /** 判定なしの確認。反映状況（appliedVersion）をStatusHubへ伝える。 */
  async function heartbeat(): Promise<boolean> {
    try {
      const response = await fetcher({ appliedVersion: state.appliedVersion });
      state.appliedVersion = response.appVersion;
      state.lastHeartbeatAtMs = now();
      return true;
    } catch (error) {
      onError(error);
      return false;
    }
  }

  return { decide, heartbeat, state };
}
