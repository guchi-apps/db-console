import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATH_PREFIXES = ["/login", "/api/auth"];

// NextAuth v5 のデフォルトセッションCookie名（database戦略）。
// https://developer.mozilla.org/docs/Web/HTTP/Cookies#cookie_prefixes の "__Secure-" はHTTPS本番用。
const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"];

/**
 * ここでは「Cookieが存在するか」の軽量チェックのみ行う。
 * PrismaAdapter（mariadbドライバ）を使った本格的なセッション検証（auth()）を
 * Proxy内で呼び出すと、Next.js 16 + Turbopackのバンドル環境でクラッシュするため
 * （Node.jsランタイムのはずだが mariadb ドライバと非互換）、ここでは行わない。
 * 実際のセッション有効性・許可リスト・操作モードの検証は、各ページ/APIルート側で
 * auth() を呼んで行う（Next.js公式ドキュメントが推奨する「Proxyだけに頼らない」方針にも合致）。
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) =>
    request.cookies.has(name),
  );
  if (!hasSessionCookie) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
