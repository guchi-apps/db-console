import { ImageResponse } from "next/og";

import { AppIconCanvas } from "@/lib/app-branding";

// PWA（manifest.ts の icons）から参照するアイコン。`/icons/192`・`/icons/512` で配信する。
// icon.tsx（favicon）と違い、Androidが角を大きく削るmaskableとしても使うためグリフを小さく置く。
// ビルド時に静的生成し、それ以外のサイズは404にする。
const SIZES = [192, 512];

export const dynamicParams = false;

export function generateStaticParams() {
  return SIZES.map((size) => ({ size: String(size) }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const px = Number(size);

  if (!SIZES.includes(px)) {
    return new Response("Not Found", { status: 404 });
  }

  return new ImageResponse(<AppIconCanvas size={px} glyphRatio={0.6} />, {
    width: px,
    height: px,
  });
}
