import { signIn } from "@/auth";
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
          await signIn("google");
        }}
      >
        <Button type="submit" size="lg">
          Googleでログイン
        </Button>
      </form>
    </div>
  );
}
