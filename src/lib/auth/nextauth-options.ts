import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ALLOWED_EMAIL_DOMAIN } from "./constants";
import type { UserRole } from "./types";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
    error: "/unauthorized",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") return false;
      const email = user.email?.toLowerCase();
      if (!email || !email.endsWith(ALLOWED_EMAIL_DOMAIN)) return false;

      await db
        .insert(users)
        .values({ id: email, email, role: "USER" })
        .onConflictDoNothing();

      return true;
    },
    async jwt({ token, account, user }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
      }
      // Only hit the DB on initial sign-in (when `user` is set). Subsequent
      // calls reuse role from the JWT; users sign out/in to pick up role changes.
      if (user?.email) {
        const email = user.email.toLowerCase();
        const [row] = await db
          .select({ id: users.id, email: users.email, role: users.role })
          .from(users)
          .where(eq(users.id, email))
          .limit(1);
        token.sub = row?.id ?? email;
        token.email = row?.email ?? email;
        token.role = (row?.role as UserRole) ?? "USER";
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.email = token.email ?? session.user.email ?? "";
        session.user.role = token.role ?? "USER";
      }
      return session;
    },
  },
};
