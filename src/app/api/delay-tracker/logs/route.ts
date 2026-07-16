import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { delayLogs, delayReasonCategoryEnum, jiraIssues } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { authOptions } from "@/lib/auth/nextauth-options";
import { OTHER_PROJECT_CATEGORIES, type DelayCategoryValue } from "@/components/delay-tracker/categories";
import { fetchDelayLogEntry, isValidDateString } from "@/lib/delay-tracker/entries";

const VALID_CATEGORIES = new Set<string>(delayReasonCategoryEnum.enumValues);

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
  const responsibleEmail = (body.responsibleEmail as string | undefined)?.trim() || null;
  const responsibleName = (body.responsibleName as string | undefined)?.trim() || null;
  const note = (body.note as string | undefined)?.trim() || null;
  const linkedProjectId = (body.linkedProjectId as string | undefined) || null;
  const linkedIssueId = (body.linkedIssueId as string | undefined) || null;

  if (typeof issueId !== "string" || !issueId) {
    return NextResponse.json({ error: "issueId is required" }, { status: 400 });
  }
  if (typeof category !== "string" || !VALID_CATEGORIES.has(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  if (!isValidDateString(delayDate)) {
    return NextResponse.json({ error: "delayDate must be YYYY-MM-DD" }, { status: 400 });
  }
  const needsLink = OTHER_PROJECT_CATEGORIES.has(category as DelayCategoryValue);
  if (needsLink && (!linkedProjectId || !linkedIssueId)) {
    return NextResponse.json(
      { error: "linkedProjectId and linkedIssueId are required for this category" },
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
  return NextResponse.json({ log }, { status: 201 });
}
