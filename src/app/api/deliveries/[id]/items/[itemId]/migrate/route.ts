import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { and, eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { deliveries, deliveryItems, deliveryTransfers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { authOptions } from "@/lib/auth/nextauth-options";
import { canManageDeliveries } from "@/lib/auth/types";
import { isValidUuid } from "@/lib/validation";

type Params = { params: Promise<{ id: string; itemId: string }> };

/**
 * Re-home a committed item from this delivery to a different one — a pure
 * move, not a copy: the source row is deleted and a new row is created in
 * the target, carrying over its current status/comment/audit fields (moving
 * batches doesn't change whether the underlying Jira task was delivered).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id: sourceDeliveryId, itemId } = await params;
  if (!isValidUuid(sourceDeliveryId) || !isValidUuid(itemId)) {
    return NextResponse.json({ error: "id and itemId must be valid UUIDs" }, { status: 400 });
  }
  if (!canManageDeliveries(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const targetDeliveryId = body.targetDeliveryId;
  if (!isValidUuid(targetDeliveryId)) {
    return NextResponse.json({ error: "targetDeliveryId must be a valid UUID" }, { status: 400 });
  }
  if (targetDeliveryId === sourceDeliveryId) {
    return NextResponse.json({ error: "Target delivery must be different from the source" }, { status: 400 });
  }

  const [source] = await db
    .select()
    .from(deliveryItems)
    .where(and(eq(deliveryItems.id, itemId), eq(deliveryItems.deliveryId, sourceDeliveryId)))
    .limit(1);
  if (!source) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [target] = await db
    .select({
      id: deliveries.id,
      projectId: deliveries.projectId,
      name: deliveries.name,
      deliveryDate: deliveries.deliveryDate,
      deletedAt: deliveries.deletedAt,
      completedAt: deliveries.completedAt,
    })
    .from(deliveries)
    .where(eq(deliveries.id, targetDeliveryId))
    .limit(1);
  if (!target || target.deletedAt) {
    return NextResponse.json({ error: "Target delivery not found" }, { status: 404 });
  }
  if (target.completedAt) {
    return NextResponse.json({ error: "Can't migrate an item into a completed delivery" }, { status: 400 });
  }

  const [sourceDelivery] = await db
    .select({ projectId: deliveries.projectId, name: deliveries.name, deliveryDate: deliveries.deliveryDate })
    .from(deliveries)
    .where(eq(deliveries.id, sourceDeliveryId))
    .limit(1);

  const session = await getServerSession(authOptions);
  const movedByName = session?.user?.name?.trim() || null;

  // Insert-into-target, log-the-transfer, delete-from-source as one unit:
  // once a transfer log write sits between the two moves, a crash halfway
  // through could otherwise leave an untracked move (no log) or a phantom
  // transfer paired with a duplicated item still sitting in both deliveries.
  const result = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(deliveryItems)
      .values({
        deliveryId: targetDeliveryId,
        issueId: source.issueId,
        addedBy: user.id,
        addedByName: source.addedByName,
        status: source.status,
        statusComment: source.statusComment,
        statusSetBy: source.statusSetBy,
        statusSetByName: source.statusSetByName,
        statusSetAt: source.statusSetAt,
      })
      .onConflictDoNothing()
      .returning({ id: deliveryItems.id });
    if (!inserted) return null;

    await tx.insert(deliveryTransfers).values({
      issueId: source.issueId,
      newItemId: inserted.id,
      fromDeliveryId: sourceDeliveryId,
      fromDeliveryName: sourceDelivery?.name ?? "Unknown delivery",
      fromDeliveryDate: sourceDelivery?.deliveryDate ?? target.deliveryDate,
      toDeliveryId: targetDeliveryId,
      toDeliveryName: target.name,
      toDeliveryDate: target.deliveryDate,
      movedBy: user.id,
      movedByName,
    });

    await tx.delete(deliveryItems).where(eq(deliveryItems.id, itemId));
    return inserted;
  });

  if (!result) {
    return NextResponse.json({ error: "That issue is already in the target delivery" }, { status: 409 });
  }

  revalidateTag("deliveries", "max");
  const projectIds = new Set([target.projectId, sourceDelivery?.projectId].filter(Boolean) as string[]);
  for (const projectId of projectIds) revalidateTag(`project:${projectId}`, "max");
  revalidateTag("my-tasks", "max");

  return NextResponse.json({ ok: true, issueId: source.issueId });
}
