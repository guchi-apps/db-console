import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";

import { db } from "@/lib/db";

const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // 8時間（issue #1の推奨値）

function getAllowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: {
    strategy: "database",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    signIn({ user }) {
      // 許可リスト未設定時は fail-closed（全拒否）。DB管理ツールのため
      // subscription-lists 等の個人ツールより厳格側に倒す。
      const allowedEmails = getAllowedEmails();
      if (allowedEmails.length === 0) return false;
      return !!user.email && allowedEmails.includes(user.email.toLowerCase());
    },
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      if (user.id) {
        await db.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
      }
    },
  },
});
