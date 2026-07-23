import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { isValidUuid } from "@/lib/validation";
import { fetchDeliverySummaries, type DeliverySummary } from "@/lib/deliveries/entries";

// Matches MAX_IDS in delay-tracker/summaries/route.ts — the same list
// surfaces mount both badges together, so they should tolerate the same
// batch size.
const MAX_IDS = 500;

export type DeliverySummariesResponse = { summaries: Record<string, DeliverySummary> };

/**
 * Batched "does this issue have an active delivery" lookup — every list
 * surface with a <DeliveryBadge> calls this once (via the shared client-side
 * batcher in delivery-summary-cache.ts) instead of one request per row.
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

  const summaries = await fetchDeliverySummaries(issueIds);
  return NextResponse.json({ summaries } satisfies DeliverySummariesResponse);
}
