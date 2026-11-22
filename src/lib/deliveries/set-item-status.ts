/**
 * The one routine that records a delivery item's outcome, shared by the item PATCH route and the
 * environment-movement "confirm statuses" step so both apply the same rules and write the same
 * audit trail.
 *
 * Delivery status describes the ISSUE ("was this actually delivered"), not the batch it is viewed
 * through: an item committed to two deliveries at once cannot be Delivered in one and Pending in
 * the other, so every delivery_items row of the issue mirrors the outcome. The mirrored update
 * and its history row are one transaction, so a crash cannot drop the audit trail of a change
 * that did take effect.
 */
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deliveryItems, deliveryStatusHistory } from "@/lib/db/schema";
import type { DeliveryStatusValue } from "@/lib/deliveries/status";
import { isIssueDone } from "@/lib/deliveries/entries";
import { FEATURE_FLAGS, isEnabled } from "@/lib/feature-flags";
import { checkDeliveryGate } from "@/lib/test-cases/gate";

export type StatusGate = { blocked: false } | { blocked: true; message: string; code?: "tc_signoff_required" };

/**
 * The preconditions of setting an outcome: anything other than "pending" needs the issue at
 * canonical status DONE, and (when the test-case feature is on) an issue with test cases needs a
 * dev/tester sign-off before it can be marked delivered. Reverting to "pending" is always allowed.
 */
export async function checkItemStatusGates(args: {
  issueId: string;
  fromStatus: DeliveryStatusValue;
  toStatus: DeliveryStatusValue;
}): Promise<StatusGate> {
  if (args.toStatus !== "pending") {
    const done = await isIssueDone(args.issueId);
    if (!done) {
      return { blocked: true, message: "This issue must be in a DONE status before its delivery outcome can be set." };
    }
  }
  if (await isEnabled(FEATURE_FLAGS.TEST_CASES)) {
    const gate = await checkDeliveryGate({ issueId: args.issueId, fromStatus: args.fromStatus, toStatus: args.toStatus });
    if (gate.blocked) return { blocked: true, message: gate.message, code: "tc_signoff_required" };
  }
  return { blocked: false };
}

export type ItemStatusWrite = {
  deliveryId: string;
  deliveryName: string;
  /** The delivery_items row the change is made through. */
  itemId: string;
  issueId: string;
  nextStatus: DeliveryStatusValue;
  statusComment: string | null;
  userId: string;
  userName: string | null;
  at?: Date;
  /**
   * Checked UNDER the row locks: when the item is currently in this status and `nextStatus` differs, nothing is
   * written ({changed:false, skipped:"downgrade"}). The movement confirm uses it for "never take a Jira back from
   * delivered", so a concurrent change between its read and its write cannot be overwritten.
   */
  neverDowngradeFrom?: DeliveryStatusValue;
};

/**
 * Write the outcome on every delivery_items row of the issue and log ONE history row when the
 * status really changes (re-saving the same status with a new comment is not a transition).
 * The current status is re-read under row locks (all rows of the issue, in id order) so two concurrent
 * writers cannot both log the same transition or deadlock.
 */
export async function writeItemStatus(w: ItemStatusWrite): Promise<{ changed: boolean; affectedDeliveryIds: string[]; skipped?: "downgrade" }> {
  const at = w.at ?? new Date();
  return db.transaction(async (tx) => {
    // Lock EVERY delivery_items row of the issue in one statement, in a fixed (id) order: the update
    // below touches all of them, so two writers on the same issue (through two deliveries) queue up
    // here instead of taking the row locks in opposite orders (deadlock, SQLSTATE 40P01).
    const locked = await tx
      .select({ id: deliveryItems.id, status: deliveryItems.status })
      .from(deliveryItems)
      .where(eq(deliveryItems.issueId, w.issueId))
      .orderBy(asc(deliveryItems.id))
      .for("update");
    const fromStatus = locked.find((r) => r.id === w.itemId)?.status ?? "pending";
    if (w.neverDowngradeFrom && fromStatus === w.neverDowngradeFrom && w.nextStatus !== fromStatus) {
      return { changed: false, affectedDeliveryIds: [], skipped: "downgrade" as const };
    }

    const rows = await tx
      .update(deliveryItems)
      .set({
        status: w.nextStatus,
        statusComment: w.statusComment,
        statusSetBy: w.userId,
        statusSetByName: w.userName,
        statusSetAt: at,
      })
      .where(eq(deliveryItems.issueId, w.issueId))
      .returning({ deliveryId: deliveryItems.deliveryId });

    const changed = fromStatus !== w.nextStatus;
    if (changed) {
      await tx.insert(deliveryStatusHistory).values({
        issueId: w.issueId,
        deliveryId: w.deliveryId,
        deliveryName: w.deliveryName || "Unknown delivery",
        fromStatus,
        toStatus: w.nextStatus,
        statusComment: w.statusComment,
        changedBy: w.userId,
        changedByName: w.userName,
        changedAt: at,
      });
    }
    return { changed, affectedDeliveryIds: [...new Set(rows.map((r) => r.deliveryId))] };
  });
}
