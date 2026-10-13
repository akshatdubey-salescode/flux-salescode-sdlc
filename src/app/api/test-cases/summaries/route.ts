import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { FEATURE_FLAGS, isEnabled } from "@/lib/feature-flags";
import { isValidUuid } from "@/lib/validation";
import { fetchTcSummaries, type TcSummary } from "@/lib/test-cases/summary";

// Same cap as the other batched summary routes: a row list can mount this many chips at once.
const MAX_IDS = 500;

export type TcSummariesResponse = {
  /** False when Test Cases is switched off: chips render nothing at all. */
  enabled: boolean;
  /** Only issues that have test cases; the rest are absent ("No TCs"). */
  summaries: Record<string, TcSummary>;
};

/** Batched TC status lookup behind the shared client cache (tc-summary-cache.ts). */
export async function POST(req: NextRequest) {
  await requireAuth();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const issueIds = (body as { issueIds?: unknown })?.issueIds;
  if (!Array.isArray(issueIds) || issueIds.length === 0) {
    return NextResponse.json({ error: "issueIds must be a non-empty array" }, { status: 400 });
  }
  if (issueIds.length > MAX_IDS) return NextResponse.json({ error: `issueIds must not exceed ${MAX_IDS}` }, { status: 400 });
  if (!issueIds.every(isValidUuid)) return NextResponse.json({ error: "every issueId must be a valid UUID" }, { status: 400 });

  if (!(await isEnabled(FEATURE_FLAGS.TEST_CASES))) {
    return NextResponse.json({ enabled: false, summaries: {} } satisfies TcSummariesResponse);
  }
  const summaries = await fetchTcSummaries(issueIds);
  return NextResponse.json({ enabled: true, summaries } satisfies TcSummariesResponse);
}
