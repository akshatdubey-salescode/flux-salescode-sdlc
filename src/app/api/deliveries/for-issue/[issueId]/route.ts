import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { isValidUuid } from "@/lib/validation";
import { fetchIssueDeliveriesDetail } from "@/lib/deliveries/entries";

type Params = { params: Promise<{ issueId: string }> };

/** Everything the delivery-badge popup needs for one issue: Jira details + every active delivery it belongs to. */
export async function GET(_req: NextRequest, { params }: Params) {
  await requireAuth();
  const { issueId } = await params;
  if (!isValidUuid(issueId)) {
    return NextResponse.json({ error: "issueId must be a valid UUID" }, { status: 400 });
  }

  const detail = await fetchIssueDeliveriesDetail(issueId);
  if (!detail) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
