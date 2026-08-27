"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Lightbulb } from "lucide-react";

import { APP_CHANGELOG } from "@/lib/changelog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "Asia/Tokyo",
});

function formatDate(date: string) {
  const parsed = new Date(`${date}T00:00:00+09:00`);
  return Number.isNaN(parsed.getTime()) ? date : dateFormatter.format(parsed);
}

/**
 * 設定画面の「更新履歴」ダイアログ。中身（`APP_CHANGELOG`）はリリースのたびに
 * `scripts/version-changelog.mjs` が先頭へ足すため、ここを手で直す必要は無い。
 *
 * `usage`（どう使うか）は画面で使える変化が無いリリースでは生成されないため、
 * 無いときは枠ごと出さない（空の見出しだけが残ると書き漏らしに見えるため）。
 */
export function ChangelogDialog({ currentVersion }: { currentVersion: string }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger className={cn(buttonVariants({ variant: "outline" }), "min-h-11 px-3")}>
        更新履歴
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="bg-background fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100%-4rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border p-6 shadow-lg transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <Dialog.Title className="text-lg font-semibold">更新履歴</Dialog.Title>
          <Dialog.Description className="text-muted-foreground mt-1 text-sm">
            これまでの変更内容を新しい順に表示します。
          </Dialog.Description>

          <div className="-mr-2 mt-4 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-2">
            {APP_CHANGELOG.map((entry, index) => (
              <section
                key={entry.version}
                className={cn("flex flex-col gap-2", index > 0 && "border-t pt-5")}
              >
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-semibold tabular-nums">v{entry.version}</h3>
                  {entry.version === currentVersion && (
                    <span className="border-primary/30 bg-primary/10 rounded-full border px-1.5 py-px text-[0.65rem] font-medium">
                      使用中
                    </span>
                  )}
                  <time dateTime={entry.date} className="text-muted-foreground ml-auto text-xs">
                    {formatDate(entry.date)}
                  </time>
                </div>

                <ul className="flex flex-col gap-1.5">
                  {entry.changes.map((change) => (
                    <li key={change} className="flex gap-2 text-sm">
                      <span className="bg-muted-foreground/60 mt-2 size-1 shrink-0 rounded-full" />
                      <span className="min-w-0">{change}</span>
                    </li>
                  ))}
                </ul>

                {entry.usage && entry.usage.length > 0 && (
                  <div className="bg-muted/50 flex flex-col gap-1 rounded-md border p-3">
                    <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
                      <Lightbulb className="size-3.5" />
                      使い方
                    </p>
                    <ol className="flex list-decimal flex-col gap-0.5 pl-5 text-xs">
                      {entry.usage.map((line) => (
                        <li key={line}>{line.replace(/^\d+[.)]\s*/, "")}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </section>
            ))}
          </div>

          <div className="mt-6 flex justify-end">
            <Dialog.Close className={cn(buttonVariants({ variant: "outline" }), "min-h-11 px-3")}>
              閉じる
            </Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
