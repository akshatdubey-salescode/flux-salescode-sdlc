import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { deliveries } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { canManageDeliveries } from "@/lib/auth/types";
import { authOptions } from "@/lib/auth/nextauth-options";
import { isValidUuid, isValidDateString, parseOptionalText } from "@/lib/validation";
import { fetchDeliveryById, type DeliveryWithItems } from "@/lib/deliveries/entries";

type Params = { params: Promise<{ id: string }> };

export type DeliveryResponse = { delivery: DeliveryWithItems };

/** Edit a delivery's name/date/notify-days/responsible people — delays happen, so the date is always editable. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
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

  const [existing] = await db.select().from(deliveries).where(eq(deliveries.id, id)).limit(1);
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updates: Partial<typeof deliveries.$inferInsert> = {};
  let expectedUpdatedAt: string | undefined;

  if (body.expectedUpdatedAt !== undefined) {
    if (typeof body.expectedUpdatedAt !== "string" || Number.isNaN(new Date(body.expectedUpdatedAt).getTime())) {
      return NextResponse.json({ error: "expectedUpdatedAt must be an ISO timestamp" }, { status: 400 });
    }
    expectedUpdatedAt = body.expectedUpdatedAt;
  }

  if (body.name !== undefined) {
    const name = parseOptionalText(body.name);
    if (!name) {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
    }
    updates.name = name;
  }
  if (body.deliveryDate !== undefined) {
    if (!isValidDateString(body.deliveryDate)) {
      return NextResponse.json({ error: "deliveryDate must be a valid YYYY-MM-DD date" }, { status: 400 });
    }
    updates.deliveryDate = body.deliveryDate;
  }
  if (body.notifyDaysBefore !== undefined) {
    const n = body.notifyDaysBefore;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
      return NextResponse.json({ error: "notifyDaysBefore must be a non-negative integer" }, { status: 400 });
    }
    updates.notifyDaysBefore = n;
  }
  if (body.responsibleEmails !== undefined) {
    if (!Array.isArray(body.responsibleEmails) || !body.responsibleEmails.every((v) => typeof v === "string")) {
      return NextResponse.json({ error: "responsibleEmails must be a string array" }, { status: 400 });
    }
    updates.responsibleEmails = body.responsibleEmails;
  }
  if (body.responsibleNames !== undefined) {
    if (!Array.isArray(body.responsibleNames) || !body.responsibleNames.every((v) => typeof v === "string")) {
      return NextResponse.json({ error: "responsibleNames must be a string array" }, { status: 400 });
    }
    updates.responsibleNames = body.responsibleNames;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  updates.updatedAt = new Date();

  const [updated] = await db
    .update(deliveries)
    .set(updates)
    .where(
      expectedUpdatedAt
        ? and(eq(deliveries.id, id), sql`${deliveries.updatedAt} = ${expectedUpdatedAt}::timestamptz`)
        : eq(deliveries.id, id)
    )
    .returning({ id: deliveries.id });
  if (!updated) {
    return NextResponse.json(
      { error: "This delivery changed after you opened it. Refresh and try again." },
      { status: 409 }
    );
  }

  revalidateTag("deliveries", "max");
  revalidateTag(`project:${existing.projectId}`, "max");
  revalidateTag("my-tasks", "max");

  const delivery = await fetchDeliveryById(id);
  if (!delivery) {
    return NextResponse.json({ error: "Updated delivery could not be loaded" }, { status: 500 });
  }
  return NextResponse.json({ delivery } satisfies DeliveryResponse);
}

/** Soft-delete a delivery — its items/history stay in the DB, just no longer active. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }
  if (!canManageDeliveries(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await getServerSession(authOptions);
  const deletedByName = session?.user?.name?.trim() || null;

  const [deleted] = await db
    .update(deliveries)
    .set({ deletedAt: new Date(), deletedBy: user.id, deletedByName, updatedAt: new Date() })
    .where(and(eq(deliveries.id, id), isNull(deliveries.deletedAt)))
    .returning({ id: deliveries.id, projectId: deliveries.projectId });
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  revalidateTag("deliveries", "max");
  revalidateTag(`project:${deleted.projectId}`, "max");
  revalidateTag("my-tasks", "max");

  return NextResponse.json({ ok: true });
}
