"use client";

import { useEffect } from "react";

export function RegisterServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // インストール不可のブラウザ・環境では無視する（PWA対応は付加価値であり必須機能ではない）。
      });
    }
  }, []);

  return null;
}
