import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";
import { APP_DESCRIPTION, APP_ICON_BACKGROUND, APP_NAME } from "@/lib/app-branding";

describe("manifest", () => {
  it("表示名・説明・テーマ色が app-branding の定義と一致する", () => {
    const result = manifest();

    expect(result.name).toBe(APP_NAME);
    expect(result.short_name).toBe(APP_NAME);
    expect(result.description).toBe(APP_DESCRIPTION);
    expect(result.theme_color).toBe(APP_ICON_BACKGROUND);
    expect(result.background_color).toBe(APP_ICON_BACKGROUND);
  });

  it("PWAアイコンが maskable と any の両方を 192/512 で持つ", () => {
    const icons = manifest().icons ?? [];

    // src は src/app/icons/[size]/route.tsx が配信する固定URL。ここが食い違うと
    // ホーム画面へ追加したときにアイコンだけ 404 になる。
    for (const size of ["192x192", "512x512"]) {
      for (const purpose of ["maskable", "any"]) {
        const icon = icons.find((entry) => entry.sizes === size && entry.purpose === purpose);
        expect(icon, `${size} / ${purpose} のアイコンが無い`).toBeDefined();
        expect(icon?.src).toBe(`/icons/${size.split("x")[0]}`);
        expect(icon?.type).toBe("image/png");
      }
    }
  });
});
