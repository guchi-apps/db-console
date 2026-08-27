"use client";

/**
 * 発行したDBユーザーのパスワードを1度だけ表示する枠。
 * この値はサーバー側に保存していないため、画面を離れると二度と表示できない。
 */
export function DbUserPasswordNotice({
  account,
  password,
}: {
  account?: string;
  password: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <p className="font-medium">
        {account ? `${account} のパスワードを発行しました` : "パスワードを発行しました"}
      </p>
      <code className="bg-background rounded px-2 py-1 font-mono break-all select-all">
        {password}
      </code>
      <p className="text-xs">
        この画面を離れると二度と表示できません（保存していません）。控えたうえで、利用する
        アプリの環境変数へ設定してください。
      </p>
    </div>
  );
}
