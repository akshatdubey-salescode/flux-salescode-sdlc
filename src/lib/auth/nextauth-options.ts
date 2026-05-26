import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ALLOWED_EMAIL_DOMAIN } from "./constants";
import type { UserRole } from "./types";

export const authOptions: NextAuthOptions = {
  secret: process.env.GLOBAL_AUTH_SECRET,
  providers: [
    GoogleProvider({
      clientId: process.env.GLOBAL_AUTH_GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GLOBAL_AUTH_GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          access_type: "offline",
          prompt: "select_account consent",
          hd: ALLOWED_EMAIL_DOMAIN.replace(/^@/, ""),
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") return false;
      const email = user.email?.toLowerCase();
      if (!email || !email.endsWith(ALLOWED_EMAIL_DOMAIN)) return false;

      try {
        await db
          .insert(users)
          .values({ id: email, email, role: "USER" })
          .onConflictDoNothing();
      } catch (err) {
        // Non-fatal: getCurrentUser will retry on the first protected request
        console.error("[auth] signIn DB insert failed:", err);
      }

      return true;
    },
    async jwt({ token, account, user }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
      }
      if (user?.email) {
        const email = user.email.toLowerCase();
        try {
          const [row] = await db
            .select({ id: users.id, email: users.email, role: users.role })
            .from(users)
            .where(eq(users.id, email))
            .limit(1);
          token.sub = row?.id ?? email;
          token.email = row?.email ?? email;
          token.role = (row?.role as UserRole) ?? "USER";
        } catch (err) {
          console.error("[auth] jwt DB select failed:", err);
          token.sub = email;
          token.email = email;
          token.role = "USER";
        }
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
