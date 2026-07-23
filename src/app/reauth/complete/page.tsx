import { redirect } from "next/navigation";

import { requireSessionForPage } from "@/lib/session";
import { markReauthVerified, sanitizeReturnTo } from "@/lib/reauth";

export default async function ReauthCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  // ここに到達した時点で、直前の signIn(prompt: "login") によるGoogle再ログインが
  // 完了し、新しいセッションCookieがブラウザに設定済みのため、そのセッションを
  // 再認証済みとしてマークできる。
  await requireSessionForPage();
  const { returnTo } = await searchParams;
  await markReauthVerified();
  redirect(sanitizeReturnTo(returnTo));
}
