"use client";

import { useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 管理対象データベースを外すカード（#233）。一覧とは別のカードに分け、DBを選んでから
 * 削除を押す。削除は毎回、アプリのデザインに合わせた確認ダイアログ（AlertDialog）を出してから
 * フォームを送信する。ダイアログは補助であり、認可はサーバーアクション側が担う。
 */
export function DeleteManagedDatabaseCard({
  action,
  names,
}: {
  action: (formData: FormData) => void;
  names: string[];
}) {
  const [selected, setSelected] = useState("");

  return (
    <section className="flex flex-col gap-2 rounded-lg border p-4">
      <h2 className="font-medium">管理対象から外す</h2>
      <p className="text-muted-foreground text-sm">
        外したDBは自動登録の対象から外れます。DB自体は削除されません。
      </p>
      {names.length === 0 ? (
        <p className="text-muted-foreground text-sm">外せるDBがありません</p>
      ) : (
        <AlertDialog.Root>
          <div className="flex items-center gap-2">
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              aria-label="管理対象から外すDB"
              className="min-h-11 min-w-0 flex-1 rounded-md border px-3 py-2 text-sm"
            >
              <option value="" disabled>
                DBを選択
              </option>
              {names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <AlertDialog.Trigger
              disabled={selected === ""}
              className={cn(
                buttonVariants({ variant: "destructive" }),
                "min-h-11 px-3 disabled:opacity-50",
              )}
            >
              削除
            </AlertDialog.Trigger>
          </div>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/50 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
            <AlertDialog.Popup className="bg-background fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border p-6 shadow-lg transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
              <AlertDialog.Title className="text-lg font-semibold">削除の確認</AlertDialog.Title>
              <AlertDialog.Description className="text-muted-foreground mt-2 text-sm">
                {selected} を管理対象から削除します。この操作は取り消せません。
              </AlertDialog.Description>
              <div className="mt-6 flex justify-end gap-3">
                <AlertDialog.Close
                  className={cn(buttonVariants({ variant: "outline" }), "min-h-11 px-3")}
                >
                  キャンセル
                </AlertDialog.Close>
                <form action={action}>
                  <input type="hidden" name="name" value={selected} />
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
      )}
    </section>
  );
}
