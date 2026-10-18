import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/app-version/route";
import { APP_VERSION } from "@/lib/app-version";
import { isPublicPath } from "@/lib/public-paths";

// /api/app-version（#220）。deploy.yml のヘルスチェックは、この応答の `sha` が今回デプロイした
// コミット（APP_COMMIT_SHA）と一致するまで成功にしない。未ログインで取れる経路なので、
// 返すのが版と SHA だけであることも確かめる。

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/app-version", () => {
  it("APP_COMMIT_SHA と package.json の版だけを返し、キャッシュさせない", async () => {
    vi.stubEnv("APP_COMMIT_SHA", "0123456789abcdef0123456789abcdef01234567");

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      version: APP_VERSION,
      sha: "0123456789abcdef0123456789abcdef01234567",
    });
  });

  it("APP_COMMIT_SHA が未設定・空なら sha は null", async () => {
    vi.stubEnv("APP_COMMIT_SHA", "");

    const res = await GET();

    expect(await res.json()).toEqual({ version: APP_VERSION, sha: null });
  });

  it("deploy.yml の照合が期待する形（\"sha\":\"<SHA>\"）で出力される", async () => {
    vi.stubEnv("APP_COMMIT_SHA", "abc123");

    const res = await GET();

    expect(await res.text()).toContain('"sha":"abc123"');
  });
});

describe("isPublicPath", () => {
  it("/api/app-version は未ログインでも素通りさせる", () => {
    expect(isPublicPath("/api/app-version")).toBe(true);
  });

  it("/api/app-version は完全一致だけで、配下や似た名前のパスは公開しない", () => {
    expect(isPublicPath("/api/app-version/extra")).toBe(false);
    expect(isPublicPath("/api/app-versions")).toBe(false);
    expect(isPublicPath("/api/databases")).toBe(false);
  });

  it("従来の公開パス（/login・/auth 配下）は変わらない", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/databases/foo")).toBe(false);
  });
});
