import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_PATH_PREFIXES = ["/login", "/auth/callback"];

/**
 * リクエストごとに Supabase のアクセストークンをリフレッシュし、更新後のCookieを
 * レスポンスに書き戻す。Server Component は Cookie を書き込めないため、この処理が
 * ないとアクセストークン（デフォルト有効期限1時間）失効後にリフレッシュトークンが
 * 有効でもセッションが切れて見えてしまう。
 *
 * ここでの認証チェックは楽観的なもの（Next.js公式ドキュメントの "optimistic checks"）
 * であり、許可リスト判定・8時間絶対タイムアウト・5分再認証などの本格的な検証は
 * 各ページ/APIルートから呼ばれる src/lib/session.ts 側で行う。
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // createServerClient と getClaims() の間に他のロジックを挟まない
  // （トークンリフレッシュが getClaims() 呼び出しの副作用として行われるため）。
  const { data } = await supabase.auth.getClaims();

  const { pathname } = request.nextUrl;
  if (!data && !PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
