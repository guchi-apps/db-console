import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "db-console",
    short_name: "db-console",
    description: "スマートフォン向けMariaDB管理コンソール",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0a0a0a",
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" }],
  };
}
