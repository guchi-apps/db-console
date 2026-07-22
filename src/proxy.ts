import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { auth } from "@/auth";

const PUBLIC_PATH_PREFIXES = ["/login", "/api/auth"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const session = await auth();
  if (!session?.user) {
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
