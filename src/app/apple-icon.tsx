import { ImageResponse } from "next/og";

import { AppIconCanvas } from "@/lib/app-branding";

// iOSのホーム画面に出るアイコン。iOSはmanifestのiconsではなくこのapple-touch-iconを使う。
// 角を丸められるだけでマスクはされないため、グリフはPWAアイコンより大きめに置く。
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<AppIconCanvas size={size.width} glyphRatio={0.68} />, size);
}
