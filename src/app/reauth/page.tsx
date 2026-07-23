import { signIn } from "@/auth";
import { requireSessionForPage } from "@/lib/session";
import { sanitizeReturnTo } from "@/lib/reauth";
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
          await signIn(
            "google",
            { redirectTo: `/reauth/complete?returnTo=${encodeURIComponent(safeReturnTo)}` },
            { prompt: "login" },
          );
        }}
      >
        <Button type="submit" size="lg">
          Googleで本人確認する
        </Button>
      </form>
    </main>
  );
}
