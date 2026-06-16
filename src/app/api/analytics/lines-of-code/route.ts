import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { currentFiscalQuarterChip } from "@/lib/date-utils";
import { fetchLinesOfCode, type LocRow } from "@/app/(app)/views/lines-of-code/data";

// ── Types ─────────────────────────────────────────────────────────────────────

export type LinesOfCodeResponse = {
  range: { start: string; end: string };
  /** People ranked by net lines of code (additions − deletions), net DESC. */
  people: LocRow[];
};

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * Net lines of code per person over a date window. Thin wrapper around the same
 * `fetchLinesOfCode` query that powers the /views/lines-of-code page, so the
 * dashboard's "Top Net LOC" card and that page never diverge.
 */
export async function GET(request: Request) {
  try {
    await requireAuth();
    const p = new URL(request.url).searchParams;

    const fq = currentFiscalQuarterChip();
    const start = p.get("start") ?? fq.start;
    const end = p.get("end") ?? fq.end;

    const people = await fetchLinesOfCode(start, end);
    const response: LinesOfCodeResponse = { range: { start, end }, people };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Lines of code error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
