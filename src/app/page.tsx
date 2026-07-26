import Link from "next/link";

import { getDatabasesConfig } from "@/lib/config";
import { requireSessionForPage } from "@/lib/session";

const MODE_LABEL: Record<string, string> = {
  "read-only": "閲覧のみ",
  "data-write": "データ編集可",
  "schema-write": "構造変更可",
};

export default async function Home() {
  await requireSessionForPage();
  const databases = await getDatabasesConfig();

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-2xl flex-1 flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">データベース一覧</h1>
        <Link href="/settings" className="text-muted-foreground text-sm hover:underline">
          設定
        </Link>
      </div>
      <ul className="flex flex-col gap-3">
        {databases.map((entry) => (
          <li key={entry.name}>
            <Link
              href={`/databases/${entry.name}/tables`}
              className="flex items-center justify-between rounded-lg border p-4 hover:bg-accent"
            >
              <div className="flex flex-col">
                <span className="font-medium">{entry.label}</span>
                <span className="text-muted-foreground text-sm">{entry.name}</span>
              </div>
              <span className="text-muted-foreground text-xs">
                {MODE_LABEL[entry.mode]}
              </span>
            </Link>
          </li>
        ))}
        {databases.length === 0 && (
          <li className="text-muted-foreground text-sm">
            管理対象データベースが登録されていません。「設定」から登録してください。
          </li>
        )}
      </ul>
    </main>
  );
}
