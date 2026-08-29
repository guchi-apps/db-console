"use client";

import { useRef, useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { TriangleAlert } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 確認ダイアログに出す1行。`field` を指定するとフォームの入力値を読み、
 * `value` を指定するとその固定値を出す（「操作」の種類など）。
 */
export interface SchemaChangeField {
  label: string;
  /** 値を読み取るフォーム項目の name。 */
  field?: string;
  /** 固定値。`field` より優先する。 */
  value?: string;
  /** 値の読み方。checkbox は on/off を、select は選択肢の表示文言を出す。 */
  kind?: "text" | "checkbox" | "select";
  /** 未入力のときに出す文言（既定は「指定なし」）。 */
  empty?: string;
  /** checkbox のときに出す文言（既定は「はい」「いいえ」）。 */
  checkedLabel?: string;
  uncheckedLabel?: string;
}

interface Row {
  label: string;
  value: string;
}

function readRow(form: HTMLFormElement, data: FormData, spec: SchemaChangeField): Row {
  if (spec.value !== undefined) {
    return { label: spec.label, value: spec.value };
  }
  if (!spec.field) {
    return { label: spec.label, value: spec.empty ?? "指定なし" };
  }

  if (spec.kind === "checkbox") {
    const checked = data.get(spec.field) === "on";
    return {
      label: spec.label,
      value: checked ? (spec.checkedLabel ?? "はい") : (spec.uncheckedLabel ?? "いいえ"),
    };
  }

  if (spec.kind === "select") {
    // 送信値（value）ではなく、利用者が画面で見ている選択肢の文言を出す。
    const element = form.elements.namedItem(spec.field);
    if (element instanceof HTMLSelectElement) {
      const text = element.selectedOptions[0]?.textContent?.trim();
      return { label: spec.label, value: text || (spec.empty ?? "指定なし") };
    }
  }

  const raw = data.get(spec.field);
  const text = typeof raw === "string" ? raw.trim() : "";
  return { label: spec.label, value: text || (spec.empty ?? "指定なし") };
}

/**
 * 構造変更（DDL）を実行するフォームの送信ボタン（#105）。
 *
 * 押した時点でフォームの入力値を読み、「何が実行されるか」を並べた確認ダイアログを出す。
 * 実行を選ぶと `form.requestSubmit()` で本来の送信（サーバーアクション）へ進む。
 * ダイアログはポータルでフォームの外に描画されるため、`type="submit"` では送信できない。
 *
 * 再認証そのものはサーバーアクション側（`assertSchemaChangeReauth()`）が担保する。
 * ここでは、まだ本人確認が済んでいないときに「実行の前に本人確認へ進む」ことを予告する。
 */
export function SchemaChangeConfirmButton({
  title,
  description,
  fields,
  reauthVerified,
  confirmLabel,
  children,
  className,
  tone = "default",
}: {
  /** ダイアログの見出し（例: 「カラム追加の確認」）。 */
  title: string;
  /** 何に対する操作かの説明（例: 「app_car の vehicles テーブルの構造を変更します。」）。 */
  description: string;
  fields: SchemaChangeField[];
  reauthVerified: boolean;
  /** 実行ボタンの文言。既定は本人確認の状態に応じて切り替える。 */
  confirmLabel?: string;
  children: React.ReactNode;
  className?: string;
  tone?: "default" | "danger";
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  function openWithSummary() {
    const form = triggerRef.current?.closest("form");
    if (!form) return;
    // type="button" なのでブラウザ標準の入力チェックが走らない。ここで明示的に走らせる。
    if (!form.reportValidity()) return;

    const data = new FormData(form);
    setRows(fields.map((spec) => readRow(form, data, spec)));
    setOpen(true);
  }

  function submit() {
    setOpen(false);
    triggerRef.current?.closest("form")?.requestSubmit();
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <button
        ref={triggerRef}
        type="button"
        onClick={openWithSummary}
        className={className}
      >
        {children}
      </button>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/50 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialog.Popup className="bg-background fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100%-4rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg border p-6 shadow-lg transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <div className="flex flex-col gap-1">
            <AlertDialog.Title className="text-lg font-semibold">{title}</AlertDialog.Title>
            <AlertDialog.Description className="text-muted-foreground text-sm">
              {description}
            </AlertDialog.Description>
          </div>

          <dl className="divide-border divide-y rounded-lg border text-sm">
            {rows.map((row) => (
              <div key={row.label} className="grid grid-cols-[7rem_1fr] gap-3 px-3 py-2">
                <dt className="text-muted-foreground text-xs">{row.label}</dt>
                <dd className="min-w-0 break-words">{row.value}</dd>
              </div>
            ))}
          </dl>

          <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              構造の変更は取り消せません。
              {reauthVerified
                ? "本人確認は済んでいるため、このまま実行されます。"
                : "実行するとGoogleアカウントでの本人確認へ進みます（入力内容は保持されません）。"}
            </span>
          </p>

          <div className="flex justify-end gap-3">
            <AlertDialog.Close
              className={cn(buttonVariants({ variant: "outline" }), "min-h-11 px-3")}
            >
              キャンセル
            </AlertDialog.Close>
            <button
              type="button"
              onClick={submit}
              className={cn(
                buttonVariants({ variant: tone === "danger" ? "destructive" : "default" }),
                "min-h-11 px-3",
              )}
            >
              {confirmLabel ?? (reauthVerified ? "実行する" : "本人確認して実行")}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
