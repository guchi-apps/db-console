import Link from "next/link";

import { getDatabasesConfig } from "@/lib/config";
import { syncManagedAppDatabases } from "@/lib/managed-db-sync";
import { requireSessionForPage } from "@/lib/session";

export default async function Home() {
  const session = await requireSessionForPage();
  // app_ で始まるDBは登録操作なしで一覧に出す（#97）。
  await syncManagedAppDatabases(session.user.id);
  const databases = await getDatabasesConfig();

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-2xl flex-1 flex-col gap-4 p-6 md:max-w-5xl md:gap-6 md:p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold md:text-2xl">データベース一覧</h1>
        {/* md以上はサイドバーに設定への導線があるため出さない。 */}
        <Link href="/settings" className="text-muted-foreground text-sm hover:underline md:hidden">
          設定
        </Link>
      </div>
      <ul className="flex flex-col gap-3 md:grid md:grid-cols-2 md:gap-4 xl:grid-cols-3">
        {databases.map((entry) => (
          <li key={entry.name}>
            <Link
              href={`/databases/${entry.name}/tables`}
              className="flex items-center justify-between gap-3 rounded-lg border p-4 hover:bg-accent md:h-full md:flex-col md:items-start md:gap-3"
            >
              <span className="min-w-0 truncate font-medium">{entry.name}</span>
            </Link>
          </li>
        ))}
        {databases.length === 0 && (
          <li className="text-muted-foreground text-sm">
            管理対象データベースがありません。「設定」から登録してください。
          </li>
        )}
      </ul>
    </main>
  );
}
