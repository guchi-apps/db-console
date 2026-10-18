// /auth 配下（callback・signout）は未ログイン状態で叩かれても安全なため素通りさせる。
const PUBLIC_PATH_PREFIXES = ["/login", "/auth"];

// 完全一致でだけ公開するパス。
// /api/app-version はデプロイのヘルスチェック（127.0.0.1 から未ログインで叩く）が稼働版の SHA を
// 照合するため公開する（#220）。返すのは版と SHA だけ。前方一致にすると `/api/app-version/...`
// のような将来のルートまで黙って公開されるため、完全一致に限る。
const PUBLIC_EXACT_PATHS = ["/api/app-version"];

/** `src/proxy.ts` が未ログインでも素通りさせるパスか。 */
export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_EXACT_PATHS.includes(pathname) ||
    PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}
