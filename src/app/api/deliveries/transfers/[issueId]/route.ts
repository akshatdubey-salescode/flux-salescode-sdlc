import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { isValidUuid } from "@/lib/validation";
import { fetchDeliveryTransferHistory, type DeliveryTransferEntry } from "@/lib/deliveries/entries";

type Params = { params: Promise<{ issueId: string }> };

export type DeliveryTransferHistoryResponse = {
  transfers: DeliveryTransferEntry[];
};

/**
 * Every time this issue was migrated between deliveries, most recent first.
 * Viewing history isn't a manage-deliveries action — requireAuth() only.
 * An issue that's never been migrated returns an empty array, not a 404.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  await requireAuth();
  const { issueId } = await params;
  if (!isValidUuid(issueId)) {
    return NextResponse.json({ error: "issueId must be a valid UUID" }, { status: 400 });
  }

  const transfers = await fetchDeliveryTransferHistory(issueId);
  return NextResponse.json({ transfers } satisfies DeliveryTransferHistoryResponse);
}
