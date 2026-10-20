// Shared guards for the TC API routes: signed in, and the feature flag is on.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuth, type AuthUser } from "@/lib/auth/server";
import { authOptions } from "@/lib/auth/nextauth-options";
import { FEATURE_FLAGS, isEnabled } from "@/lib/feature-flags";
import { hasMinRole } from "@/lib/auth/types";
import { SheetsError } from "@/lib/google/sheets";
import { SourceLockedError } from "./lock";
import { SourceError } from "./source";

export type TcRequestUser = AuthUser & { name: string | null };

export async function requireTestCasesUser(): Promise<TcRequestUser | NextResponse> {
  const user = await requireAuth();
  if (!(await isEnabled(FEATURE_FLAGS.TEST_CASES))) {
    return NextResponse.json({ error: "Test Cases is not enabled." }, { status: 404 });
  }
  const session = await getServerSession(authOptions);
  return { ...user, name: session?.user?.name?.trim() || null };
}

export function isResponse(v: unknown): v is NextResponse {
  return v instanceof NextResponse;
}

/** Maps source/Sheets failures to a status and a stable `code` the page can act on (e.g. offer "Connect Google"). */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof SourceLockedError) return NextResponse.json({ error: err.message, code: "source_locked" }, { status: 409 });
  if (err instanceof SourceError) return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
  if (err instanceof SheetsError) {
    const status =
      err.code === "not_connected" || err.code === "scope_missing" ? 409
      : err.code === "no_access" ? 403
      : err.code === "not_found" ? 404
      : err.code === "rate_limited" ? 429
      : 502;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error("[test-cases] unexpected error:", err);
  return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
}

/** The acting user as the review rules see them. */
export function toActor(user: TcRequestUser): { email: string; name: string | null; isAdmin: boolean } {
  return { email: user.email, name: user.name, isAdmin: hasMinRole(user.role, "ADMIN") };
}

/** Absolute origin for links in emails. */
export function appOrigin(req: { nextUrl: { origin: string } }): string {
  return (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "");
}
