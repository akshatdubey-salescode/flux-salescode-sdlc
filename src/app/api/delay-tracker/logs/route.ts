import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { delayLogs, delayReasonCategoryEnum, jiraIssues } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { authOptions } from "@/lib/auth/nextauth-options";
import {
  OTHER_PROJECT_CATEGORIES,
  PERSON_REQUIRED_CATEGORIES,
  isDelayCategory,
  type DelayCategoryValue,
} from "@/lib/delay-tracker/categories";
import {
  fetchDelayLogEntry,
  isValidDateString,
  isValidUuid,
  parseOptionalText,
} from "@/lib/delay-tracker/entries";

/** Append one delay entry to an issue's history. Multiple entries per issue are expected. */
export async function POST(req: NextRequest) {
  const user = await requireAuth();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const issueId = body.issueId;
  const category = body.category;
  const delayDate = body.delayDate;
  const responsibleEmail = parseOptionalText(body.responsibleEmail) ?? null;
  const responsibleName = parseOptionalText(body.responsibleName) ?? null;
  const note = parseOptionalText(body.note) ?? null;
  const linkedProjectId = parseOptionalText(body.linkedProjectId) ?? null;
  const linkedIssueId = parseOptionalText(body.linkedIssueId) ?? null;

  if (!isValidUuid(issueId)) {
    return NextResponse.json({ error: "issueId must be a valid UUID" }, { status: 400 });
  }
  if (!isDelayCategory(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  if (!isValidDateString(delayDate)) {
    return NextResponse.json({ error: "delayDate must be a valid YYYY-MM-DD date" }, { status: 400 });
  }
  for (const field of ["responsibleEmail", "responsibleName", "note"] as const) {
    if (body[field] !== undefined && body[field] !== null && typeof body[field] !== "string") {
      return NextResponse.json({ error: `${field} must be a string or null` }, { status: 400 });
    }
  }
  for (const field of ["linkedProjectId", "linkedIssueId"] as const) {
    if (body[field] !== undefined && body[field] !== null && typeof body[field] !== "string") {
      return NextResponse.json({ error: `${field} must be a UUID string or null` }, { status: 400 });
    }
  }
  if (linkedProjectId && !isValidUuid(linkedProjectId)) {
    return NextResponse.json({ error: "linkedProjectId must be a valid UUID" }, { status: 400 });
  }
  if (linkedIssueId && !isValidUuid(linkedIssueId)) {
    return NextResponse.json({ error: "linkedIssueId must be a valid UUID" }, { status: 400 });
  }
  const needsLink = OTHER_PROJECT_CATEGORIES.has(category as DelayCategoryValue);
  if (needsLink && (!linkedProjectId || !linkedIssueId)) {
    return NextResponse.json(
      { error: "linkedProjectId and linkedIssueId are required for this category" },
      { status: 400 }
    );
  }
  if (PERSON_REQUIRED_CATEGORIES.has(category as DelayCategoryValue) && !responsibleEmail) {
    return NextResponse.json(
      { error: "responsibleEmail is required for this category" },
      { status: 400 }
    );
  }

  const [issue] = await db
    .select({ projectId: jiraIssues.projectId })
    .from(jiraIssues)
    .where(eq(jiraIssues.id, issueId))
    .limit(1);
  if (!issue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  if (needsLink) {
    const [linkedIssue] = await db
      .select({ projectId: jiraIssues.projectId })
      .from(jiraIssues)
      .where(eq(jiraIssues.id, linkedIssueId!))
      .limit(1);
    if (!linkedIssue || linkedIssue.projectId !== linkedProjectId) {
      return NextResponse.json(
        { error: "Linked issue does not belong to the linked project" },
        { status: 400 }
      );
    }
    if (linkedProjectId === issue.projectId) {
      return NextResponse.json(
        { error: "Linked project must be different from the delayed issue's project" },
        { status: 400 }
      );
    }
  }

  const session = await getServerSession(authOptions);
  const loggedByName = session?.user?.name?.trim() || null;

  const [created] = await db
    .insert(delayLogs)
    .values({
      issueId,
      projectId: issue.projectId,
      category: category as (typeof delayReasonCategoryEnum.enumValues)[number],
      delayDate,
      responsibleEmail,
      responsibleName,
      note,
      linkedProjectId: needsLink ? linkedProjectId : null,
      linkedIssueId: needsLink ? linkedIssueId : null,
      loggedBy: user.id,
      loggedByName,
    })
    .returning({ id: delayLogs.id });

  // Both the org-wide and this-project's delay analytics cache on "use
  // cache" — without this they'd show stale (missing) data until that
  // profile's next revalidation instead of picking up the new entry promptly.
  revalidateTag("delay-logs", "max");
  revalidateTag(`project:${issue.projectId}`, "max");

  // Re-fetch fully joined (not the bare `.returning()` row) so a freshly
  // created "Other Project" entry's linkedJiraKey/linkedSummary/
  // linkedProjectName are present immediately, without needing to close and
  // reopen the popup to trigger a real GET.
  const log = await fetchDelayLogEntry(created.id);
  if (!log) {
    return NextResponse.json({ error: "Created delay entry could not be loaded" }, { status: 500 });
  }
  return NextResponse.json({ log }, { status: 201 });
}
