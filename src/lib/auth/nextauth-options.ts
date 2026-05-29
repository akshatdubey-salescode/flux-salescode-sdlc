import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ALLOWED_EMAIL_DOMAIN } from "./constants";
import type { UserRole } from "./types";
import { saveIntegration } from "@/lib/google/oauth";
import { userMeetingsTag } from "@/lib/google/cache-tags";
import { ensureUserJiraAccountId } from "@/lib/jira/identity";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

export const authOptions: NextAuthOptions = {
  secret: process.env.GLOBAL_AUTH_SECRET,
  providers: [
    GoogleProvider({
      clientId: process.env.GLOBAL_AUTH_GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GLOBAL_AUTH_GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          access_type: "offline",
          // "consent" forces Google to show the scope screen so we get a
          // refresh token even when the user has previously authorized the
          // app. Without this, additive scopes can silently skip consent and
          // Google withholds the refresh token, breaking calendar sync.
          prompt: "select_account consent",
          hd: ALLOWED_EMAIL_DOMAIN.replace(/^@/, ""),
          // Request calendar.readonly alongside the identity scopes so users
          // are asked to grant calendar access as part of sign-in instead of
          // a separate Settings flow. Declining calendar still lets sign-in
          // succeed — they can connect later via /settings.
          scope: `openid email profile ${CALENDAR_SCOPE}`,
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

      // Resolve this user's Jira accountId in the background so subsequent
      // boards/timelines/unplanned views can match them even when Atlassian
      // hides their email on issue payloads. Fire-and-forget: any failure is
      // logged inside the helper and must not block sign-in. The next login
      // is a no-op once the column is set.
      void ensureUserJiraAccountId(email);

      // Capture calendar tokens when the user grants calendar.readonly during
      // sign-in. account.scope is space-separated and reflects what the user
      // actually granted (they may untick calendar on the consent screen). If
      // they declined or Google withheld the refresh token, we silently skip —
      // /settings still has the explicit Connect button as a fallback.
      const grantedScopes = (account.scope ?? "").split(" ");
      const hasCalendar = grantedScopes.includes(CALENDAR_SCOPE);
      const refreshToken = account.refresh_token;
      const accessToken = account.access_token;
      if (hasCalendar && refreshToken && accessToken) {
        try {
          const expiresAt = account.expires_at;
          const expiresIn = expiresAt
            ? Math.max(60, expiresAt - Math.floor(Date.now() / 1000))
            : 3600;
          await saveIntegration({
            userId: email,
            accessToken,
            refreshToken,
            expiresIn,
            googleEmail: email,
          });
          // Bust cached "(not connected)" meeting responses so observer boards
          // and /my-tasks pick up the new integration on the next request,
          // even before the first cron tick runs.
          revalidateTag(userMeetingsTag(email), "max");
        } catch (err) {
          // Don't block sign-in if calendar persistence fails — user can
          // still use the app and reconnect via /settings.
          console.error("[auth] calendar token persistence failed:", err);
        }
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
