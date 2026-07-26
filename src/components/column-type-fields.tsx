"use client";

import { useState } from "react";

import type { ColumnTypeOption } from "@/lib/column-types";

/**
 * カラム型セレクトとパラメータ1/2入力を1セットで扱うクライアントコンポーネント。
 * 選んだ型に応じてパラメータ欄のヒント表示を切り替え、使わないパラメータは無効化する。
 * <tr> の直下に置く前提で <td> を3つ返す（フラグメントなのでDOM構造は崩れない）。
 */
export function ColumnTypeFields({
  index,
  options,
}: {
  index: number;
  options: ColumnTypeOption[];
}) {
  const [typeKey, setTypeKey] = useState(options[0]?.key ?? "");
  const current = options.find((o) => o.key === typeKey);

  return (
    <>
      <td className="px-2 py-1">
        <select
          name={`typeKey_${index}`}
          value={typeKey}
          onChange={(e) => setTypeKey(e.target.value)}
          className="rounded-md border px-2 py-1"
        >
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1">
        <input
          type="text"
          name={`param1_${index}`}
          placeholder={current?.param1Hint ?? "使用しません"}
          disabled={!current?.param1Hint}
          className="w-32 rounded-md border px-2 py-1 disabled:bg-muted disabled:text-muted-foreground"
        />
      </td>
      <td className="px-2 py-1">
        <input
          type="text"
          name={`param2_${index}`}
          placeholder={current?.param2Hint ?? "使用しません"}
          disabled={!current?.param2Hint}
          className="w-28 rounded-md border px-2 py-1 disabled:bg-muted disabled:text-muted-foreground"
        />
      </td>
    </>
  );
}

/** カラム追加フォーム（flex/labelレイアウト）向けの単発版。 */
export function ColumnTypeSelectFields({ options }: { options: ColumnTypeOption[] }) {
  const [typeKey, setTypeKey] = useState(options[0]?.key ?? "");
  const current = options.find((o) => o.key === typeKey);

  return (
    <>
      <label className="flex flex-col gap-1 text-xs">
        型
        <select
          name="typeKey"
          value={typeKey}
          onChange={(e) => setTypeKey(e.target.value)}
          className="rounded-md border px-2 py-1 text-sm"
        >
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        パラメータ1
        <input
          type="text"
          name="param1"
          placeholder={current?.param1Hint ?? "使用しません"}
          disabled={!current?.param1Hint}
          className="w-40 rounded-md border px-2 py-1 text-sm disabled:bg-muted disabled:text-muted-foreground"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        パラメータ2
        <input
          type="text"
          name="param2"
          placeholder={current?.param2Hint ?? "使用しません"}
          disabled={!current?.param2Hint}
          className="w-32 rounded-md border px-2 py-1 text-sm disabled:bg-muted disabled:text-muted-foreground"
        />
      </label>
    </>
  );
}
