import Link from "next/link";
import { notFound } from "next/navigation";

import { getDatabaseEntry } from "@/lib/config";
import { getDatabaseRelations } from "@/lib/introspection";
import { requireSessionForPage } from "@/lib/session";

import { RelationView } from "./relation-view";

export default async function RelationsPage({
  params,
}: {
  params: Promise<{ db: string }>;
}) {
  await requireSessionForPage();
  const { db } = await params;
  const entry = await getDatabaseEntry(db);
  if (!entry) {
    notFound();
  }

  const relations = await getDatabaseRelations(db);

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-2xl flex-1 flex-col gap-4 p-6 md:max-w-none md:gap-4 md:p-8">
      <div className="flex flex-col md:border-b md:pb-4">
        <Link
          href={`/databases/${db}/tables`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {entry.name}
        </Link>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold md:text-2xl">リレーション</h1>
          <div className="hidden gap-2 md:flex">
            <Link
              href={`/databases/${db}/tables`}
              className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
            >
              テーブル一覧
            </Link>
            <Link
              href={`/databases/${db}/sql`}
              className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
            >
              SQL実行
            </Link>
          </div>
        </div>
      </div>

      <RelationView db={db} relations={relations} />
    </main>
  );
}
