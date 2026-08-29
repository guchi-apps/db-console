import Link from "next/link";
import { Check, ShieldAlert } from "lucide-react";

import { REAUTH_VALID_MINUTES, reauthPath } from "@/lib/reauth";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 構造変更（DDL）を扱う画面の先頭に置く、本人確認の状態表示（#105）。
 *
 * 管理対象DBごとの操作モードを廃止したかわりに、構造を変える操作の直前で再認証を求めている。
 * 実行してからリダイレクトされると入力中のフォームが失われるため、**入力を始める前に**
 * 済ませられる導線をここへ出す。実行時のチェックそのものは
 * `assertSchemaChangeReauth()`（src/lib/reauth.ts）がサーバー側で行う。
 */
export function SchemaChangeNotice({
  verified,
  returnTo,
}: {
  verified: boolean;
  returnTo: string;
}) {
  if (verified) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-green-300 bg-green-50 px-3.5 py-3 text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
        <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-medium">本人確認済みです</p>
          <p className="text-xs leading-relaxed">
            確認から{REAUTH_VALID_MINUTES}
            分間は、構造変更をそのまま実行できます。期限が切れたあとに実行すると、もう一度本人確認を求めます。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
      <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium">構造変更には本人確認が必要です</p>
        <p className="text-xs leading-relaxed">
          カラム・インデックス・テーブルを変更する前に、Googleアカウントで本人確認を行います。
          一度確認すると{REAUTH_VALID_MINUTES}分間有効です。
          入力してから確認へ進むと入力内容が失われるため、先に済ませることをおすすめします。
        </p>
      </div>
      <Link
        href={reauthPath(returnTo)}
        className={cn(
          buttonVariants({ variant: "outline" }),
          "min-h-11 w-full px-3 sm:w-auto",
        )}
      >
        本人確認する
      </Link>
    </div>
  );
}
