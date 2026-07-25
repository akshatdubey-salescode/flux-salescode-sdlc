import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { and, eq, inArray } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { deliveries, deliveryItems } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid, parseOptionalText } from "@/lib/validation";
import { isDeliveryStatus } from "@/lib/deliveries/status";
import { isIssueDone, fetchDeliveryById, type DeliveryWithItems } from "@/lib/deliveries/entries";

type Params = { params: Promise<{ id: string; itemId: string }> };

export type DeliveryItemResponse = { delivery: DeliveryWithItems };

/**
 * Set (or clear) a delivery item's outcome status + comment. Open to any
 * authenticated user — unlike creating/adding/removing items, tracking
 * what actually happened isn't restricted to admins/delivery managers.
 * Setting anything other than "pending" requires the issue to already be
 * at canonical status DONE; reverting to "pending" is exempt so an
 * accidental mark can always be undone.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id: deliveryId, itemId } = await params;
  if (!isValidUuid(deliveryId) || !isValidUuid(itemId)) {
    return NextResponse.json({ error: "id and itemId must be valid UUIDs" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(deliveryItems)
    .where(and(eq(deliveryItems.id, itemId), eq(deliveryItems.deliveryId, deliveryId)))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!isDeliveryStatus(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  const statusComment = parseOptionalText(body.statusComment) ?? null;
  if (statusComment === undefined) {
    return NextResponse.json({ error: "statusComment must be a string or null" }, { status: 400 });
  }

  if (body.status !== "pending") {
    const done = await isIssueDone(existing.issueId);
    if (!done) {
      return NextResponse.json(
        { error: "This issue must be in a DONE status before its delivery outcome can be set." },
        { status: 400 }
      );
    }
  }

  const session = await getServerSession(authOptions);
  const statusSetByName = session?.user?.name?.trim() || null;
  const statusSetAt = new Date();

  // Delivery status describes the ISSUE ("was this actually delivered"), not
  // the batch it happens to be viewed through — an item committed to two
  // deliveries at once can't be genuinely Delivered in one and Pending in
  // the other, so every delivery_items row for this issue mirrors the same
  // outcome. Matching `issueId` alone (not deliveryId) reaches every sibling.
  const updatedRows = await db
    .update(deliveryItems)
    .set({
      status: body.status,
      statusComment,
      statusSetBy: user.id,
      statusSetByName,
      statusSetAt,
    })
    .where(eq(deliveryItems.issueId, existing.issueId))
    .returning({ deliveryId: deliveryItems.deliveryId });

  const delivery = await fetchDeliveryById(deliveryId);
  if (!delivery) {
    return NextResponse.json({ error: "Delivery could not be loaded" }, { status: 500 });
  }

  // Mirroring can touch sibling deliveries in a different project than the
  // one this request came in through — revalidate every project actually
  // affected, not just this one, so their Delivery columns/badges don't
  // stay stale for the rest of the cacheLife window.
  const affectedDeliveryIds = [...new Set(updatedRows.map((r) => r.deliveryId))];
  const affectedProjectIds = new Set([delivery.projectId]);
  if (affectedDeliveryIds.length > 1) {
    const rows = await db
      .select({ projectId: deliveries.projectId })
      .from(deliveries)
      .where(inArray(deliveries.id, affectedDeliveryIds));
    for (const r of rows) affectedProjectIds.add(r.projectId);
  }

  // "deliveries" alone doesn't reach the two OTHER cached routes that embed
  // a per-issue Delivery column (the project issues list + every user's My
  // Tasks) — without these, their "use cache" responses stay stale for the
  // full cacheLife regardless of client-side reloads.
  revalidateTag("deliveries", "max");
  for (const projectId of affectedProjectIds) revalidateTag(`project:${projectId}`, "max");
  revalidateTag("my-tasks", "max");

  return NextResponse.json({ delivery } satisfies DeliveryItemResponse);
}

/** Remove an issue from a delivery — a hard delete (see schema comments: this is closer to unchecking a box than an audit event). */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id: deliveryId, itemId } = await params;
  if (!isValidUuid(deliveryId) || !isValidUuid(itemId)) {
    return NextResponse.json({ error: "id and itemId must be valid UUIDs" }, { status: 400 });
  }
  if (!canManageDeliveries(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [deliveryRow] = await db
    .select({ projectId: deliveries.projectId })
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId))
    .limit(1);

  const [deleted] = await db
    .delete(deliveryItems)
    .where(and(eq(deliveryItems.id, itemId), eq(deliveryItems.deliveryId, deliveryId)))
    .returning({ id: deliveryItems.id });
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // "deliveries" alone doesn't reach the two OTHER cached routes that embed
  // a per-issue Delivery column (the project issues list + every user's My
  // Tasks) — without these, their "use cache" responses stay stale for the
  // full cacheLife regardless of client-side reloads. This was the actual
  // cause of a removed item's date still showing after a hard refresh.
  revalidateTag("deliveries", "max");
  if (deliveryRow) revalidateTag(`project:${deliveryRow.projectId}`, "max");
  revalidateTag("my-tasks", "max");

  return NextResponse.json({ ok: true });
}
