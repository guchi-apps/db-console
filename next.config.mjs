// @ts-check
// 拡張子を .ts にしないこと。本番の `next start` は next.config.ts を読むためだけに
// SWCのネイティブバイナリを読み込み、そのまま常駐してメモリを食う。.mjs なら読み込まれない。
// 型は JSDoc で付ける（tsconfig.json の include に next.config.mjs を入れてあるので tsc が検査する）。

/** @type {import("next").NextConfig} */
const nextConfig = {
  // LAN経由のスマートフォン実機確認用（192.168.2.114 / sslip.io経由のホスト名 / cloudflaredトンネル）。
  allowedDevOrigins: [
    "192.168.2.114",
    "192.168.2.114.sslip.io",
    "dbconsole-dev.minagu.work",
  ],
};

export default nextConfig;
