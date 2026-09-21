import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getRequestOrigin } from "@/lib/request-origin";

export async function POST() {
  const supabase = await createClient();
  // Supabase プロジェクトは他アプリと共有している。引数なしの signOut() は既定が global scope で、
  // 同じユーザーの他アプリ・他端末の refresh token まで失効させてしまう（#161）。
  // このアプリのセッションだけを破棄する。
  await supabase.auth.signOut({ scope: "local" });
  const origin = await getRequestOrigin();
  return NextResponse.redirect(`${origin}/login`);
}
