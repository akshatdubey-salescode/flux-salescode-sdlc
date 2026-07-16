import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { delayLogs, delayReasonCategoryEnum } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { OTHER_PROJECT_CATEGORIES, type DelayCategoryValue } from "@/components/delay-tracker/categories";
import { fetchDelayLogEntry, isValidDateString } from "@/lib/delay-tracker/entries";

type Params = { params: Promise<{ id: string }> };

const VALID_CATEGORIES = new Set<string>(delayReasonCategoryEnum.enumValues);

/** Edit a single delay entry (category, date, responsible person, note, or link). */
export async function PATCH(req: NextRequest, { params }: Params) {
  await requireAuth();
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const [existing] = await db.select().from(delayLogs).where(eq(delayLogs.id, id)).limit(1);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updates: Partial<typeof delayLogs.$inferInsert> = {};

  if (body.category !== undefined) {
    if (typeof body.category !== "string" || !VALID_CATEGORIES.has(body.category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
    updates.category = body.category as (typeof delayReasonCategoryEnum.enumValues)[number];
  }
  if (body.delayDate !== undefined) {
    if (!isValidDateString(body.delayDate)) {
      return NextResponse.json({ error: "delayDate must be YYYY-MM-DD" }, { status: 400 });
    }
    updates.delayDate = body.delayDate;
  }
  if (body.responsibleEmail !== undefined) {
    updates.responsibleEmail = (body.responsibleEmail as string | null)?.trim() || null;
  }
  if (body.responsibleName !== undefined) {
    updates.responsibleName = (body.responsibleName as string | null)?.trim() || null;
  }
  if (body.note !== undefined) {
    updates.note = (body.note as string | null)?.trim() || null;
  }
  if (body.linkedProjectId !== undefined) {
    updates.linkedProjectId = (body.linkedProjectId as string | null) || null;
  }
  if (body.linkedIssueId !== undefined) {
    updates.linkedIssueId = (body.linkedIssueId as string | null) || null;
  }

  const effectiveCategory = updates.category ?? existing.category;
  const needsLink = OTHER_PROJECT_CATEGORIES.has(effectiveCategory as DelayCategoryValue);
  const effectiveLinkedProjectId =
    updates.linkedProjectId !== undefined ? updates.linkedProjectId : existing.linkedProjectId;
  const effectiveLinkedIssueId =
    updates.linkedIssueId !== undefined ? updates.linkedIssueId : existing.linkedIssueId;
  if (needsLink && (!effectiveLinkedProjectId || !effectiveLinkedIssueId)) {
    return NextResponse.json(
      { error: "linkedProjectId and linkedIssueId are required for this category" },
      { status: 400 }
    );
  }
  // Only force-clear the link fields when THIS request is changing the
  // category away from an other-project one — otherwise a PATCH that never
  // touches category/link fields (e.g. just editing the note) would still
  // inject two null writes here on every request, defeating the "no fields
  // to update" guard below for a genuinely empty/no-op PATCH body.
  if (updates.category !== undefined && !needsLink) {
    updates.linkedProjectId = null;
    updates.linkedIssueId = null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  updates.updatedAt = new Date();

  await db.update(delayLogs).set(updates).where(eq(delayLogs.id, id));

  revalidateTag("delay-logs", "max");
  revalidateTag(`project:${existing.projectId}`, "max");

  // Re-fetch fully joined so an edit that changes the linked issue reflects
  // its new linkedJiraKey/linkedSummary/linkedProjectName immediately.
  const log = await fetchDelayLogEntry(id);
  return NextResponse.json({ log });
}

/** Remove a mistakenly-logged delay entry. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  await requireAuth();
  const { id } = await params;

  const [deleted] = await db
    .delete(delayLogs)
    .where(eq(delayLogs.id, id))
    .returning({ id: delayLogs.id, projectId: delayLogs.projectId });
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  revalidateTag("delay-logs", "max");
  revalidateTag(`project:${deleted.projectId}`, "max");

  return NextResponse.json({ ok: true });
}
