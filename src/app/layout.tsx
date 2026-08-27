import type { Metadata } from "next";
import { Outfit, Geist_Mono } from "next/font/google";
import "./globals.css";

import { APP_DESCRIPTION, APP_NAME } from "@/lib/app-branding";
import { RegisterServiceWorker } from "@/components/register-service-worker";
import { BottomNav } from "@/components/bottom-nav";
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

  return (
    <html lang="ja" className={htmlClassName}>
      <body className="min-h-full flex flex-col">
        <RegisterServiceWorker />
        <div className={session ? "flex min-h-full flex-1 flex-col pb-14" : "flex min-h-full flex-1 flex-col"}>
          {children}
        </div>
        {session && <BottomNav />}
      </body>
    </html>
  );
}
