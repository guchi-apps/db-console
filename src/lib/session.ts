import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import type { Session } from "next-auth";

/** ページ（Server Component）用。未認証なら /login へリダイレクトする。 */
export async function requireSessionForPage(): Promise<Session> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return session;
}

/** APIルート用。未認証なら401を返す（呼び出し側で return してレスポンスとして使う）。 */
export async function requireSessionForApi(): Promise<
  { session: Session; response?: undefined } | { session?: undefined; response: NextResponse }
> {
  const session = await auth();
  if (!session?.user) {
    return {
      response: NextResponse.json({ error: "認証が必要です" }, { status: 401 }),
    };
  }
  return { session };
}
