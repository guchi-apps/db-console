import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { requireSessionForPage } from "@/lib/session";
import { sanitizeReturnTo } from "@/lib/return-to";
import { getRequestOrigin } from "@/lib/request-origin";
import { Button } from "@/components/ui/button";

export default async function ReauthPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const session = await requireSessionForPage();
  const { returnTo } = await searchParams;
  const safeReturnTo = sanitizeReturnTo(returnTo);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">再認証が必要です</h1>
        <p className="text-muted-foreground text-sm">
          破壊的な操作を行う前に、Googleアカウントで本人確認を行います。
          <br />
          {session.user.email}
        </p>
      </div>
      <form
        action={async () => {
          "use server";
          const origin = await getRequestOrigin();
          const redirectTo = `${origin}/auth/callback?reauth=1&returnTo=${encodeURIComponent(safeReturnTo)}`;
          const supabase = await createClient();
          const { data, error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
              redirectTo,
              queryParams: { prompt: "select_account" },
            },
          });
          if (error || !data.url) {
            redirect(`/reauth?returnTo=${encodeURIComponent(safeReturnTo)}&error=signin_failed`);
          }
          redirect(data.url);
        }}
      >
        <Button type="submit" size="lg" className="min-h-11 px-6">
          Googleで本人確認する
        </Button>
      </form>
    </main>
  );
}
