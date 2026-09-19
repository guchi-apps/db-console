"use client";

import { useState } from "react";

import { KEEP_CURRENT_TYPE_KEY } from "@/lib/column-constants";
import { describeColumnDefault, parseColumnDefault } from "@/lib/column-default";
import type { ColumnTypeOption } from "@/lib/column-types";
import type { ColumnInfo } from "@/lib/introspection";

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

/**
 * カラム編集フォーム用。「現在の型のまま」を先頭に加えた選択肢を出し、
 * NULL可否・コメントは現在値を初期表示する。並び順は「変更しない」を既定にする。
 *
 * デフォルト値は「変更しない／値を指定／NULL／CURRENT_TIMESTAMP／なし」を選ばせる（#132）。
 * `column_default` はMariaDBが引用符付き（`'abc'`）や式のまま返すため、入力欄へ戻して
 * 送り返すと値が化ける。入力欄の初期値には、解釈したリテラルの中身だけを入れる。
 */
export function ColumnEditFields({
  column,
  options,
  otherColumnNames,
}: {
  column: ColumnInfo;
  options: ColumnTypeOption[];
  otherColumnNames: string[];
}) {
  const keepCurrentOption: ColumnTypeOption = {
    key: KEEP_CURRENT_TYPE_KEY,
    label: `現在の型のまま (${column.columnType})`,
  };
  const allOptions = [keepCurrentOption, ...options];
  const [typeKey, setTypeKey] = useState(keepCurrentOption.key);
  const [positionKind, setPositionKind] = useState("keep");
  const [defaultMode, setDefaultMode] = useState("keep");
  const current = allOptions.find((o) => o.key === typeKey);
  const currentDefault = parseColumnDefault(column.columnDefault);

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border p-2">
      <label className="flex flex-col gap-1 text-xs">
        型
        <select
          name="typeKey"
          value={typeKey}
          onChange={(e) => setTypeKey(e.target.value)}
          className="rounded-md border px-2 py-1 text-sm"
        >
          {allOptions.map((option) => (
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
          className="w-32 rounded-md border px-2 py-1 text-sm disabled:bg-muted disabled:text-muted-foreground"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        パラメータ2
        <input
          type="text"
          name="param2"
          placeholder={current?.param2Hint ?? "使用しません"}
          disabled={!current?.param2Hint}
          className="w-28 rounded-md border px-2 py-1 text-sm disabled:bg-muted disabled:text-muted-foreground"
        />
      </label>
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" name="nullable" defaultChecked={column.isNullable} className="h-4 w-4" />
        NULL許可
      </label>
      <label className="flex flex-col gap-1 text-xs">
        デフォルト値
        <select
          name="defaultMode"
          value={defaultMode}
          onChange={(e) => setDefaultMode(e.target.value)}
          className="rounded-md border px-2 py-1 text-sm"
        >
          <option value="keep">変更しない（現在: {describeColumnDefault(currentDefault)}）</option>
          <option value="value">値を指定</option>
          <option value="null">NULL</option>
          <option value="current_timestamp">CURRENT_TIMESTAMP（現在日時）</option>
          <option value="none">なし</option>
        </select>
      </label>
      {defaultMode === "value" && (
        <label className="flex flex-col gap-1 text-xs">
          指定する値
          <input
            type="text"
            name="defaultValue"
            defaultValue={currentDefault.kind === "literal" ? currentDefault.value : ""}
            className="w-32 rounded-md border px-2 py-1 text-sm"
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs">
        コメント
        <input
          type="text"
          name="comment"
          defaultValue={column.comment ?? ""}
          className="w-40 rounded-md border px-2 py-1 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        並び順
        <select
          name="positionKind"
          value={positionKind}
          onChange={(e) => setPositionKind(e.target.value)}
          className="rounded-md border px-2 py-1 text-sm"
        >
          <option value="keep">変更しない</option>
          <option value="first">先頭</option>
          <option value="after">指定カラムの後ろ</option>
        </select>
      </label>
      {positionKind === "after" && (
        <label className="flex flex-col gap-1 text-xs">
          対象カラム
          <select name="positionAfter" className="rounded-md border px-2 py-1 text-sm">
            {otherColumnNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
