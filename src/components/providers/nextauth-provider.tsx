"use client";

import { SessionProvider } from "next-auth/react";

// Defaults would refetch /api/auth/session on every tab refocus, which for an
// internal app where people switch between tabs all day silently dominates
// our Vercel function-invocation count. The session is JWT-backed and only
// changes when GLOBAL_AUTH_SECRET rotates or a user signs in/out — events
// the user takes on this tab anyway — so polling/refocus refetches buy no
// freshness we actually need.
export function NextAuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchOnWindowFocus={false} refetchInterval={0}>
      {children}
    </SessionProvider>
  );
}
