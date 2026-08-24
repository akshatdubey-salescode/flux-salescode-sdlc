import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { getLocSyncStatus } from "@/lib/scorecard/loc-sync-status";

// No extra access restriction beyond requireAuth() — deliberately matches the
// performance-review drill-down page itself (page.tsx's ?person= branch),
// which any authenticated user can already open for anyone. This endpoint
// only surfaces detail about a person already fully visible on that same
// page (their Jiras, PRs, GitHub login linkage); gating it tighter than the
// page hosting its button would be an inconsistent, confusing restriction.
export async function GET(request: NextRequest) {
  try {
    await requireAuth();

    const { searchParams } = request.nextUrl;
    const email = (searchParams.get("email") ?? "").trim().toLowerCase();
    const quarterKey = searchParams.get("quarter") ?? "";

    if (!email || !quarterKey) {
      return NextResponse.json({ error: "email and quarter are required" }, { status: 400 });
    }

    const rows = await getLocSyncStatus(email, quarterKey);
    return NextResponse.json({ rows });
  } catch (err) {
    console.error("[performance-review/loc-sync-status] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
