import type { MetadataRoute } from "next";

import {
  APP_DESCRIPTION,
  APP_ICON_BACKGROUND,
  APP_NAME,
} from "@/lib/app-branding";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    // OSが出す起動画面の地の色と、Androidのステータスバーの色。アイコンの背景と同じ色にすると
    // 角丸の器が背景に溶け、白いシリンダーだけが残る絵になる。アプリのUI自体は白地のまま。
    background_color: APP_ICON_BACKGROUND,
    theme_color: APP_ICON_BACKGROUND,
    // maskable（OSが角を削る）と any（そのまま表示）の両方に同じ画像を出す。
    // グリフを安全領域に収めてあるため、どちらの扱いでも図柄が欠けない。
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
