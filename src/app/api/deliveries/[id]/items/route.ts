import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { deliveries, deliveryItems } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid } from "@/lib/validation";
import { fetchDeliveryById, type DeliveryWithItems } from "@/lib/deliveries/entries";

type Params = { params: Promise<{ id: string }> };

// Comfortably above any realistic single add-batch — mirrors the MAX_IDS
// convention in delay-tracker/summaries/route.ts.
const MAX_ISSUE_IDS = 200;

export type DeliveryItemsResponse = { delivery: DeliveryWithItems };

/**
 * Attach one or more Jira issues to a delivery. No status/DONE gate here —
 * items can be planned/committed at any lifecycle stage; the gate only
 * applies when setting an outcome status. Re-adding an issue already in
 * this delivery is a silent no-op (the same issue can still belong to other
 * deliveries at the same time — only (deliveryId, issueId) is unique).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id: deliveryId } = await params;
  if (!isValidUuid(deliveryId)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }
  if (!canManageDeliveries(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
  if (issueIds.length > MAX_ISSUE_IDS) {
    return NextResponse.json({ error: `issueIds must not exceed ${MAX_ISSUE_IDS}` }, { status: 400 });
  }
  if (!issueIds.every(isValidUuid)) {
    return NextResponse.json({ error: "every issueId must be a valid UUID" }, { status: 400 });
  }

  const [delivery] = await db
    .select({ id: deliveries.id, projectId: deliveries.projectId })
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId))
    .limit(1);
  if (!delivery) {
    return NextResponse.json({ error: "Delivery not found" }, { status: 404 });
  }

  const session = await getServerSession(authOptions);
  const addedByName = session?.user?.name?.trim() || null;

  await db
    .insert(deliveryItems)
    .values(
      issueIds.map((issueId: string) => ({
        deliveryId,
        issueId,
        addedBy: user.id,
        addedByName,
      }))
    )
    .onConflictDoNothing();

  // "deliveries" alone doesn't reach the two OTHER cached routes that embed
  // a per-issue Delivery column (the project issues list + every user's My
  // Tasks) — without these, their "use cache" responses stay stale for the
  // full cacheLife regardless of client-side reloads.
  revalidateTag("deliveries", "max");
  revalidateTag(`project:${delivery.projectId}`, "max");
  revalidateTag("my-tasks", "max");

  const updated = await fetchDeliveryById(deliveryId);
  if (!updated) {
    return NextResponse.json({ error: "Delivery could not be loaded" }, { status: 500 });
  }
  return NextResponse.json({ delivery: updated } satisfies DeliveryItemsResponse);
}
