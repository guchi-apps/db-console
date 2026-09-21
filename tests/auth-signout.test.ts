import { beforeEach, describe, expect, it, vi } from "vitest";

// /auth/signout（#161）。Supabase プロジェクトは他アプリと共有しているため、引数なしの
// signOut()（既定は global scope）にすると同じユーザーの他アプリのセッションまで失効する。
// このアプリのセッションだけを破棄する local scope を渡していることを検証する。

const state = vi.hoisted(() => ({
  signOut: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signOut: state.signOut } }),
}));

vi.mock("@/lib/request-origin", () => ({ getRequestOrigin: async () => "https://console.example.com" }));

import { POST } from "@/app/auth/signout/route";

beforeEach(() => {
  state.signOut.mockReset();
});

describe("POST /auth/signout", () => {
  it("local scope でログアウトし、ログイン画面へ戻す", async () => {
    const res = await POST();

    expect(state.signOut).toHaveBeenCalledTimes(1);
    expect(state.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(res.headers.get("location")).toBe("https://console.example.com/login");
  });
});
