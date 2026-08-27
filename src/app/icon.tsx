import { ImageResponse } from "next/og";

import { AppIconCanvas } from "@/lib/app-branding";

// ブラウザのタブに出るfavicon。マスクされないためグリフを大きめに置く。
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<AppIconCanvas size={size.width} glyphRatio={0.78} />, size);
}
