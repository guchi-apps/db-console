import Link from "next/link";
import { notFound } from "next/navigation";

import { getDatabaseEntry } from "@/lib/config";
import { requireSessionForPage } from "@/lib/session";
import { db as prismaDb } from "@/lib/db";
import { SqlForm } from "./sql-form";

export default async function SqlPage({ params }: { params: Promise<{ db: string }> }) {
  const session = await requireSessionForPage();
  const { db } = await params;

  const entry = await getDatabaseEntry(db);
  if (!entry) {
    notFound();
  }

  const history = await prismaDb.sqlHistory.findMany({
    where: { userId: session.user.id, databaseName: db },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-4xl flex-1 flex-col gap-6 p-6">
      <div className="flex flex-col">
        <Link
          href={`/databases/${db}/tables`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {entry.name} のテーブル一覧
        </Link>
        <h1 className="text-xl font-semibold">SQL実行</h1>
        <p className="text-muted-foreground text-sm">
          1文のみ実行できます。GRANT/REVOKE/SET GLOBAL等の禁止SQL、DROP/TRUNCATEを含むSQL、
          条件（WHERE句）のないUPDATE/DELETEは実行できません。
        </p>
      </div>

      <SqlForm db={db} />

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">実行履歴（直近20件）</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-medium">日時</th>
                <th className="px-3 py-2 text-left font-medium">種別</th>
                <th className="px-3 py-2 text-left font-medium">SQL</th>
                <th className="px-3 py-2 text-left font-medium">結果</th>
                <th className="px-3 py-2 text-left font-medium">実行時間</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {h.createdAt.toISOString()}
                  </td>
                  <td className="px-3 py-2">{h.queryType}</td>
                  <td className="max-w-xs truncate px-3 py-2 font-mono text-xs" title={h.sqlText}>
                    {h.sqlText}
                  </td>
                  <td className="px-3 py-2">
                    {h.status === "SUCCESS" ? (
                      <span className="text-green-700">成功</span>
                    ) : (
                      <span className="text-red-700" title={h.errorMessage ?? undefined}>
                        失敗
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{h.durationMs}ms</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-muted-foreground px-3 py-6 text-center">
                    実行履歴がありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
