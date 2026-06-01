import type { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraIssues, jiraProjects } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/server";
import { extractStartDate, extractDueDate } from "@/lib/jira/dates";

export async function GET(req: NextRequest) {
  await requireRole("SUPERUSER");

  const jiraKey = req.nextUrl.searchParams.get("key");
  if (!jiraKey) return Response.json({ error: "Missing ?key= param" }, { status: 400 });

  const [row] = await db
    .select({
      id: jiraIssues.id,
      jiraKey: jiraIssues.jiraKey,
      summary: jiraIssues.summary,
      status: jiraIssues.status,
      statusCategory: jiraIssues.statusCategory,
      assigneeEmail: jiraIssues.assigneeEmail,
      jiraCreatedAt: jiraIssues.jiraCreatedAt,
      jiraUpdatedAt: jiraIssues.jiraUpdatedAt,
      syncedAt: jiraIssues.syncedAt,
      customFields: jiraIssues.customFields,
      endDateFieldIds: jiraProjects.endDateFieldIds,
      startDateFieldIds: jiraProjects.startDateFieldIds,
    })
    .from(jiraIssues)
    .innerJoin(jiraProjects, eq(jiraIssues.projectId, jiraProjects.id))
    .where(eq(jiraIssues.jiraKey, jiraKey))
    .limit(1);

  if (!row) return Response.json({ error: "Issue not found in DB" }, { status: 404 });

  const cf = (row.customFields as Record<string, unknown>) ?? {};
  const startDate = extractStartDate(cf, row.startDateFieldIds);
  const dueDate = extractDueDate(cf, row.endDateFieldIds);

  return Response.json({
    id: row.id,
    jiraKey: row.jiraKey,
    summary: row.summary,
    status: row.status,
    statusCategory: row.statusCategory,
    assigneeEmail: row.assigneeEmail,
    jiraCreatedAt: row.jiraCreatedAt,
    jiraUpdatedAt: row.jiraUpdatedAt,
    syncedAt: row.syncedAt,
    extracted: { startDate, dueDate },
    projectConfig: {
      endDateFieldIds: row.endDateFieldIds,
      startDateFieldIds: row.startDateFieldIds,
    },
    customFields: cf,
  });
}
