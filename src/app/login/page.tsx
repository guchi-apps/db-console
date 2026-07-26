import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold">db-console</h1>
        <p className="text-muted-foreground text-sm">
          許可されたGoogleアカウントでログインしてください
        </p>
      </div>
      <form
        action={async () => {
          "use server";
          const origin = (await headers()).get("origin");
          const supabase = await createClient();
          const { data, error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo: `${origin}/auth/callback` },
          });
          if (error || !data.url) {
            redirect("/login?error=signin_failed");
          }
          redirect(data.url);
        }}
      >
        <Button type="submit" size="lg" className="min-h-11 px-6">
          Googleでログイン
        </Button>
      </form>
    </div>
  );
}
