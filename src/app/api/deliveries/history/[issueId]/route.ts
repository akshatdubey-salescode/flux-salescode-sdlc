import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { isValidUuid } from "@/lib/validation";
import { fetchDeliveryHistory, type DeliveryHistoryEvent } from "@/lib/deliveries/entries";

type Params = { params: Promise<{ issueId: string }> };

export type DeliveryHistoryResponse = {
  events: DeliveryHistoryEvent[];
};

/**
 * Everything that happened to this issue's delivery commitment — migrations
 * between deliveries and status changes, merged into one chronological feed,
 * most recent first. Viewing history isn't a manage-deliveries action —
 * requireAuth() only. An issue with neither kind of event returns an empty
 * array, not a 404.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  await requireAuth();
  const { issueId } = await params;
  if (!isValidUuid(issueId)) {
    return NextResponse.json({ error: "issueId must be a valid UUID" }, { status: 400 });
  }

  const events = await fetchDeliveryHistory(issueId);
  return NextResponse.json({ events } satisfies DeliveryHistoryResponse);
}
