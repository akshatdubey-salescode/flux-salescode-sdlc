import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { fetchDelaySummaries, isValidUuid, type DelaySummary } from "@/lib/delay-tracker/entries";

// Matches MAX_ISSUES in delay-tracker/issues/route.ts and
// analytics/overview/issues/route.ts — both can mount this many
// <DelayLogButton>s at once (BucketDialog, DelayIssuesDialog), all
// registering interest within the same batch. A lower cap here would
// 400 that entire batch and mark every one of those issues "no delay".
const MAX_IDS = 500;

export type DelaySummariesResponse = { summaries: Record<string, DelaySummary> };

/**
 * Batched "does this issue have delay(s) logged" lookup — every list surface
 * with a <DelayLogButton> calls this once (via the shared client-side
 * batcher in delay-summary-cache.ts) instead of one request per row.
 */
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
  if (issueIds.length > MAX_IDS) {
    return NextResponse.json({ error: `issueIds must not exceed ${MAX_IDS}` }, { status: 400 });
  }
  if (!issueIds.every(isValidUuid)) {
    return NextResponse.json({ error: "every issueId must be a valid UUID" }, { status: 400 });
  }

  const summaries = await fetchDelaySummaries(issueIds);
  return NextResponse.json({ summaries } satisfies DelaySummariesResponse);
}
