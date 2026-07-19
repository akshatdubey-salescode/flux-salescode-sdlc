import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { delayLogs, delayReasonCategoryEnum, jiraIssues } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { authOptions } from "@/lib/auth/nextauth-options";
import {
  OTHER_PROJECT_CATEGORIES,
  PERSON_REQUIRED_CATEGORIES,
  type DelayCategoryValue,
} from "@/lib/delay-tracker/categories";
import {
  fetchDelayLogEntry,
  isValidDateString,
  isValidUuid,
  parseOptionalText,
} from "@/lib/delay-tracker/entries";

type Params = { params: Promise<{ id: string }> };

const VALID_CATEGORIES = new Set<string>(delayReasonCategoryEnum.enumValues);

/** Edit a single delay entry (category, date, responsible person, note, or link). */
export async function PATCH(req: NextRequest, { params }: Params) {
  await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }

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
  if (existing.deletedAt) {
    return NextResponse.json(
      { error: "This delay entry has been deleted and can no longer be edited." },
      { status: 400 }
    );
  }

  const updates: Partial<typeof delayLogs.$inferInsert> = {};
  let expectedUpdatedAt: string | undefined;

  if (body.expectedUpdatedAt !== undefined) {
    if (typeof body.expectedUpdatedAt !== "string") {
      return NextResponse.json({ error: "expectedUpdatedAt must be an ISO timestamp" }, { status: 400 });
    }
    if (Number.isNaN(new Date(body.expectedUpdatedAt).getTime())) {
      return NextResponse.json({ error: "expectedUpdatedAt must be an ISO timestamp" }, { status: 400 });
    }
    expectedUpdatedAt = body.expectedUpdatedAt;
  }

  if (body.category !== undefined) {
    if (typeof body.category !== "string" || !VALID_CATEGORIES.has(body.category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
    updates.category = body.category as (typeof delayReasonCategoryEnum.enumValues)[number];
  }
  if (body.delayDate !== undefined) {
    if (!isValidDateString(body.delayDate)) {
      return NextResponse.json({ error: "delayDate must be a valid YYYY-MM-DD date" }, { status: 400 });
    }
    updates.delayDate = body.delayDate;
  }
  for (const [bodyField, column] of [
    ["responsibleEmail", "responsibleEmail"],
    ["responsibleName", "responsibleName"],
    ["note", "note"],
  ] as const) {
    if (body[bodyField] === undefined) continue;
    const value = parseOptionalText(body[bodyField]);
    if (value === undefined) {
      return NextResponse.json({ error: `${bodyField} must be a string or null` }, { status: 400 });
    }
    updates[column] = value;
  }
  for (const [bodyField, column] of [
    ["linkedProjectId", "linkedProjectId"],
    ["linkedIssueId", "linkedIssueId"],
  ] as const) {
    if (body[bodyField] === undefined) continue;
    const value = parseOptionalText(body[bodyField]);
    if (value === undefined || (value !== null && !isValidUuid(value))) {
      return NextResponse.json({ error: `${bodyField} must be a valid UUID or null` }, { status: 400 });
    }
    updates[column] = value;
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
  const effectiveResponsibleEmail =
    updates.responsibleEmail !== undefined ? updates.responsibleEmail : existing.responsibleEmail;
  if (PERSON_REQUIRED_CATEGORIES.has(effectiveCategory as DelayCategoryValue) && !effectiveResponsibleEmail) {
    return NextResponse.json(
      { error: "responsibleEmail is required for this category" },
      { status: 400 }
    );
  }
  if (needsLink) {
    const [linkedIssue] = await db
      .select({ projectId: jiraIssues.projectId })
      .from(jiraIssues)
      .where(eq(jiraIssues.id, effectiveLinkedIssueId!))
      .limit(1);
    if (!linkedIssue || linkedIssue.projectId !== effectiveLinkedProjectId) {
      return NextResponse.json(
        { error: "Linked issue does not belong to the linked project" },
        { status: 400 }
      );
    }
    if (effectiveLinkedProjectId === existing.projectId) {
      return NextResponse.json(
        { error: "Linked project must be different from the delayed issue's project" },
        { status: 400 }
      );
    }
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

  const [updated] = await db
    .update(delayLogs)
    .set(updates)
    .where(
      expectedUpdatedAt
        ? and(
            eq(delayLogs.id, id),
            sql`${delayLogs.updatedAt} = ${expectedUpdatedAt}::timestamptz`
          )
        : eq(delayLogs.id, id)
    )
    .returning({ id: delayLogs.id });
  if (!updated) {
    return NextResponse.json(
      { error: "This delay entry changed after you opened it. Refresh and try again." },
      { status: 409 }
    );
  }

  revalidateTag("delay-logs", "max");
  revalidateTag(`project:${existing.projectId}`, "max");

  // Re-fetch fully joined so an edit that changes the linked issue reflects
  // its new linkedJiraKey/linkedSummary/linkedProjectName immediately.
  const log = await fetchDelayLogEntry(id);
  if (!log) {
    return NextResponse.json({ error: "Updated delay entry could not be loaded" }, { status: 500 });
  }
  return NextResponse.json({ log });
}

/**
 * Deactivate a mistakenly-logged delay entry. This is a soft delete — the
 * row (and its logged_by/logged_by_name creator audit trail) is kept
 * forever, just marked inactive and stamped with who deactivated it and
 * when, so the popup can still show its full history.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireAuth();
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }

  // Same pattern the POST route uses for loggedByName: requireAuth()'s
  // AuthUser has no `name` field, so the display name comes from the session.
  const session = await getServerSession(authOptions);
  const deletedByName = session?.user?.name?.trim() || null;

  const [deleted] = await db
    .update(delayLogs)
    .set({ deletedAt: new Date(), deletedBy: user.id, deletedByName, updatedAt: new Date() })
    .where(and(eq(delayLogs.id, id), isNull(delayLogs.deletedAt)))
    .returning({ id: delayLogs.id, projectId: delayLogs.projectId });
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  revalidateTag("delay-logs", "max");
  revalidateTag(`project:${deleted.projectId}`, "max");

  // Re-fetch fully joined so the client can show who/when it was deleted
  // without closing and reopening the popup.
  const log = await fetchDelayLogEntry(id);
  return NextResponse.json({ ok: true, log });
}
