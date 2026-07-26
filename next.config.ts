import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // LAN経由のスマートフォン実機確認用（192.168.2.114 / sslip.io経由のホスト名 / cloudflaredトンネル）。
  allowedDevOrigins: [
    "192.168.2.114",
    "192.168.2.114.sslip.io",
    "dbconsole-dev.minagu.work",
  ],
};

export default nextConfig;
