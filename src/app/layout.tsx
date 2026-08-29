import type { Metadata } from "next";
import { Outfit, Geist_Mono } from "next/font/google";
import "./globals.css";

import { APP_DESCRIPTION, APP_NAME } from "@/lib/app-branding";
import { RegisterServiceWorker } from "@/components/register-service-worker";
import { BottomNav } from "@/components/bottom-nav";
import { SideNav } from "@/components/side-nav";
import { getDatabasesConfig } from "@/lib/config";
import { getSession } from "@/lib/session";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  // iOSでホーム画面に追加したときの表示名と、スタンドアロン起動の指定。
  // iOSはmanifestのnameよりこちらを優先する。
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const htmlClassName = `${outfit.variable} ${geistMono.variable} h-full antialiased`;

  const session = await getSession();
  // サイドバーに出すDB一覧。未ログイン時は取りに行かない。
  const databases = session ? await getDatabasesConfig() : [];

  return (
    <html lang="ja" className={htmlClassName}>
      <body className="min-h-full flex flex-col">
        <RegisterServiceWorker />
        {session ? (
          // md未満: 1カラム＋下タブバー（従来どおり）。md以上: 左サイドバー＋本文の2カラム。
          <div className="flex min-h-full flex-1 flex-col md:flex-row">
            <SideNav
              databases={databases.map(({ name, label }) => ({ name, label }))}
              email={session.user.email}
            />
            <div className="flex min-h-full min-w-0 flex-1 flex-col pb-14 md:pb-0">
              {children}
            </div>
          </div>
        ) : (
          <div className="flex min-h-full flex-1 flex-col">{children}</div>
        )}
        {session && <BottomNav />}
      </body>
    </html>
  );
}
