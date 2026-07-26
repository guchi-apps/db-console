// このアプリはDBの最新状態を常に表示する必要があるため、ページやAPIレスポンスは一切キャッシュしない。
// PWAのインストール可能条件（fetchイベントの購読）を満たすためだけの最小実装。
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // 意図的に何もしない（ブラウザの通常のネットワーク処理に委ねる）。
});
