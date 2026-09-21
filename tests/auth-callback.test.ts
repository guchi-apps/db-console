import { beforeEach, describe, expect, it, vi } from "vitest";

// /auth/callback の再認証まわり（#133）。Supabase と DB はモックに差し替え、
// 「どの loginAt で AppSession が作られるか」と「どこへリダイレクトされるか」を検証する。

type Claims = { sub: string; email: string; session_id: string };

const state = vi.hoisted(() => ({
  claimsQueue: [] as Array<{ claims: Claims } | null>,
  exchangeError: null as unknown,
  signOut: vi.fn(),
  appSessionFind: vi.fn(),
  appSessionUpsert: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      // 呼ばれた順に返す（1回目: 再認証前のCookie、2回目: コード交換後のCookie）。
      getClaims: async () => ({ data: state.claimsQueue.shift() ?? null }),
      exchangeCodeForSession: async () => ({ error: state.exchangeError }),
      signOut: state.signOut,
    },
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: { upsert: async ({ create }: { create: { email: string } }) => ({ id: `user-${create.email}` }) },
    appSession: { findUnique: state.appSessionFind, upsert: state.appSessionUpsert },
  },
}));

vi.mock("@/lib/request-origin", () => ({ getRequestOrigin: async () => "https://console.example.com" }));

import { GET } from "@/app/auth/callback/route";

const HOUR = 60 * 60 * 1000;
const OWNER = "owner@example.com";

const claimsOf = (sub: string, sessionId: string, email = OWNER): { claims: Claims } => ({
  claims: { sub, email, session_id: sessionId },
});

const callback = (query: string) =>
  GET(new Request(`https://console.example.com/auth/callback?${query}`));

beforeEach(() => {
  process.env.ALLOWED_EMAILS = `${OWNER},other@example.com`;
  state.claimsQueue = [];
  state.exchangeError = null;
  state.signOut.mockReset();
  state.appSessionFind.mockReset();
  state.appSessionUpsert.mockReset();
});

describe("GET /auth/callback", () => {
  it("通常ログインでは loginAt を現在時刻にする", async () => {
    state.claimsQueue = [claimsOf("sub-a", "session-new")];

    const before = Date.now();
    const res = await callback("code=abc");

    expect(res.headers.get("location")).toBe("https://console.example.com/");
    const { create } = state.appSessionUpsert.mock.calls[0][0];
    expect(create.loginAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(create.reauthVerifiedAt).toBeNull();
    expect(state.appSessionFind).not.toHaveBeenCalled();
  });

  it("再認証では再認証前のセッションの loginAt を引き継ぐ", async () => {
    const loginAt = new Date(Date.now() - 7 * HOUR);
    state.claimsQueue = [claimsOf("sub-a", "session-old"), claimsOf("sub-a", "session-new")];
    state.appSessionFind.mockResolvedValue({ loginAt });

    const res = await callback("code=abc&reauth=1&returnTo=%2Fdatabases");

    expect(res.headers.get("location")).toBe("https://console.example.com/databases");
    expect(state.appSessionFind).toHaveBeenCalledWith({ where: { supabaseSessionId: "session-old" } });
    const { where, create } = state.appSessionUpsert.mock.calls[0][0];
    expect(where).toEqual({ supabaseSessionId: "session-new" });
    expect(create.loginAt).toEqual(loginAt);
    expect(create.reauthVerifiedAt).toBeInstanceOf(Date);
    expect(state.signOut).not.toHaveBeenCalled();
  });

  it("再認証で別のアカウントを選んだら成立させずログアウトする", async () => {
    state.claimsQueue = [
      claimsOf("sub-a", "session-old"),
      claimsOf("sub-b", "session-new", "other@example.com"),
    ];
    state.appSessionFind.mockResolvedValue({ loginAt: new Date() });

    const res = await callback("code=abc&reauth=1");

    expect(res.headers.get("location")).toBe(
      "https://console.example.com/login?error=reauth_account_mismatch",
    );
    expect(state.signOut).toHaveBeenCalledTimes(1);
    expect(state.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(state.appSessionUpsert).not.toHaveBeenCalled();
  });

  it("許可リストにないユーザーは local scope でログアウトして拒否する（#161）", async () => {
    state.claimsQueue = [claimsOf("sub-x", "session-x", "stranger@example.com")];

    const res = await callback("code=abc");

    expect(res.headers.get("location")).toBe("https://console.example.com/login?error=forbidden");
    expect(state.signOut).toHaveBeenCalledTimes(1);
    expect(state.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(state.appSessionUpsert).not.toHaveBeenCalled();
  });

  it("再認証前のセッションが8時間を過ぎていたら成立させない", async () => {
    state.claimsQueue = [claimsOf("sub-a", "session-old"), claimsOf("sub-a", "session-new")];
    state.appSessionFind.mockResolvedValue({ loginAt: new Date(Date.now() - 9 * HOUR) });

    const res = await callback("code=abc&reauth=1");

    expect(res.headers.get("location")).toBe(
      "https://console.example.com/login?error=reauth_session_expired",
    );
    expect(state.signOut).toHaveBeenCalledTimes(1);
    expect(state.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(state.appSessionUpsert).not.toHaveBeenCalled();
  });

  it("再認証前のセッションが無い（Cookieなし・記録なし）場合も成立させない", async () => {
    state.claimsQueue = [null, claimsOf("sub-a", "session-new")];

    const res = await callback("code=abc&reauth=1");

    expect(res.headers.get("location")).toBe(
      "https://console.example.com/login?error=reauth_session_expired",
    );
    expect(state.appSessionUpsert).not.toHaveBeenCalled();

    state.claimsQueue = [claimsOf("sub-a", "session-old"), claimsOf("sub-a", "session-new")];
    state.appSessionFind.mockResolvedValue(null);

    const res2 = await callback("code=abc&reauth=1");

    expect(res2.headers.get("location")).toBe(
      "https://console.example.com/login?error=reauth_session_expired",
    );
    expect(state.appSessionUpsert).not.toHaveBeenCalled();
  });
});
