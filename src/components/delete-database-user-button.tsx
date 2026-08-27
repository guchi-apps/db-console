"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** DBユーザーの削除ボタン。管理対象DBの削除と同じ確認ダイアログを挟む。 */
export function DeleteDatabaseUserButton({
  action,
  name,
  host,
}: {
  action: (formData: FormData) => void;
  name: string;
  host: string;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger
        className={cn(buttonVariants({ variant: "destructive" }), "min-h-11 px-3")}
      >
        削除
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/50 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialog.Popup className="bg-background fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border p-6 shadow-lg transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <AlertDialog.Title className="text-lg font-semibold">削除の確認</AlertDialog.Title>
          <AlertDialog.Description className="text-muted-foreground mt-2 text-sm">
            DBユーザー {name}@{host} をMariaDBから削除します。このユーザーで接続している
            アプリは接続できなくなります。この操作は取り消せません。
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-3">
            <AlertDialog.Close
              className={cn(buttonVariants({ variant: "outline" }), "min-h-11 px-3")}
            >
              キャンセル
            </AlertDialog.Close>
            <form action={action}>
              <input type="hidden" name="name" value={name} />
              <input type="hidden" name="host" value={host} />
              <button
                type="submit"
                className={cn(buttonVariants({ variant: "destructive" }), "min-h-11 px-3")}
              >
                削除する
              </button>
            </form>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
