"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Database, Home, Settings } from "lucide-react";

import { APP_ICON_BACKGROUND, APP_NAME, AppIconGlyph } from "@/lib/app-branding";

type NavDatabase = { name: string };
type NavTable = { name: string; kind: "table" | "view" };

/**
 * 開いているDB名をパスから取り出す。`/databases/<db>/...` の形だけが対象。
 */
function activeDatabaseOf(pathname: string): string | null {
  const matched = /^\/databases\/([^/]+)/.exec(pathname);
  return matched ? decodeURIComponent(matched[1]) : null;
}

function activeTableOf(pathname: string): string | null {
  const matched = /^\/databases\/[^/]+\/tables\/([^/]+)/.exec(pathname);
  return matched ? decodeURIComponent(matched[1]) : null;
}

/**
 * PC（md以上）でだけ出す左サイドバー。スマホでは `BottomNav` が担当するため `hidden` にする。
 *
 * 開いているDBのテーブル一覧はサーバー側では取れない——ルートレイアウトは `[db]` を知らず、
 * テーブル一覧を持つのはその配下のページだけであるため。既存の
 * `/api/databases/[db]/tables` をブラウザから読んで補う。
 */
export function SideNav({
  databases,
  email,
}: {
  databases: NavDatabase[];
  email?: string;
}) {
  const pathname = usePathname();
  const activeDb = activeDatabaseOf(pathname);
  const activeTable = activeTableOf(pathname);
  // 取得結果はDB名とセットで持つ。DBを切り替えた直後に前のDBの一覧を出さないため、
  // 「読み込み中」の判定はstateのクリアではなくDB名の一致で行う（effect内で同期的に
  // setStateしないための形でもある）。
  const [loaded, setLoaded] = useState<{ db: string; tables: NavTable[] } | null>(null);

  useEffect(() => {
    if (!activeDb) return;
    let cancelled = false;
    fetch(`/api/databases/${encodeURIComponent(activeDb)}/tables`)
      .then((response) => (response.ok ? response.json() : { tables: [] }))
      .then((data: { tables?: NavTable[] }) => {
        if (!cancelled) setLoaded({ db: activeDb, tables: data.tables ?? [] });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ db: activeDb, tables: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [activeDb]);

  const tables = loaded && loaded.db === activeDb ? loaded.tables : null;

  return (
    <aside className="bg-muted/40 hidden w-64 shrink-0 self-start border-r md:sticky md:top-0 md:flex md:h-dvh md:flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
        <Link href="/" className="flex items-center gap-2.5 px-2 py-3">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            style={{ background: APP_ICON_BACKGROUND }}
          >
            <AppIconGlyph size={18} />
          </span>
          <span className="font-semibold">{APP_NAME}</span>
        </Link>

        <NavLink href="/" icon={Home} active={pathname === "/"}>
          ホーム
        </NavLink>

        <p className="text-muted-foreground px-2 pt-3 pb-1 text-xs font-semibold tracking-wider uppercase">
          データベース
        </p>

        {databases.length === 0 && (
          <p className="text-muted-foreground px-2 py-1 text-xs">
            登録されていません
          </p>
        )}

        {databases.map((entry) => {
          const isActive = entry.name === activeDb;
          return (
            <div key={entry.name} className="flex flex-col">
              <NavLink
                href={`/databases/${entry.name}/tables`}
                icon={Database}
                active={isActive}
              >
                {entry.name}
              </NavLink>
              {isActive && (
                <div className="border-border ml-4 flex flex-col border-l pl-2.5">
                  {tables === null && (
                    <span className="text-muted-foreground px-2 py-1 text-xs">
                      読み込み中…
                    </span>
                  )}
                  {tables?.length === 0 && (
                    <span className="text-muted-foreground px-2 py-1 text-xs">
                      テーブルがありません
                    </span>
                  )}
                  {tables?.map((table) => (
                    <Link
                      key={table.name}
                      href={`/databases/${entry.name}/tables/${table.name}`}
                      className={`truncate rounded-md px-2 py-1 font-mono text-xs ${
                        table.name === activeTable
                          ? "bg-accent text-foreground font-medium"
                          : "text-muted-foreground hover:bg-accent/60"
                      }`}
                      title={table.name}
                    >
                      {table.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-1 border-t p-3">
        <NavLink href="/settings" icon={Settings} active={pathname.startsWith("/settings")}>
          設定
        </NavLink>
        {email && (
          <span className="text-muted-foreground truncate px-2 text-xs" title={email}>
            {email}
          </span>
        )}
        <form action="/auth/signout" method="post" className="px-2">
          <button
            type="submit"
            className="text-muted-foreground text-xs hover:underline"
          >
            ログアウト
          </button>
        </form>
      </div>
    </aside>
  );
}

function NavLink({
  href,
  icon: Icon,
  active,
  children,
}: {
  href: string;
  icon: typeof Home;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ${
        active ? "bg-background text-foreground font-medium shadow-xs" : "hover:bg-accent/60"
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${active ? "" : "text-muted-foreground"}`} />
      <span className="truncate">{children}</span>
    </Link>
  );
}
