import { NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { engineerWorkDeclarations, jiraIssues, jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { ensureCarryoverDeclarations } from "@/lib/observer/carryover";

function todayUtc(): string {
  return new Date().toISOString().split("T")[0];
}

export async function GET() {
  try {
    const user = await requireAuth();
    const today = todayUtc();

    // Auto-carry over any previous declarations whose expected completion is >= today
    await ensureCarryoverDeclarations(user.email, today);

    const rows = await db.execute(sql`
      SELECT
        ewd.id,
        ewd.comment,
        ewd.expected_completion_date,
        ewd.created_at,
        ewd.updated_at,
        ji.id          AS jira_issue_id,
        ji.jira_key,
        ji.summary,
        ji.status,
        ji.status_category,
        ji.priority,
        jp.name        AS project_name,
        jp.jira_project_key AS project_key
      FROM engineer_work_declarations ewd
      JOIN jira_issues ji ON ji.id = ewd.jira_issue_id
      JOIN jira_projects jp ON jp.id = ji.project_id
      WHERE ewd.engineer_email = ${user.email}
        AND ewd.declared_date = ${today}::date
      ORDER BY ewd.created_at ASC
    `);

    return NextResponse.json(rows.rows);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const { jiraIssueId, expectedCompletionDate } = (await request.json()) as {
      jiraIssueId: string;
      expectedCompletionDate?: string;
    };

    if (!jiraIssueId) {
      return NextResponse.json({ error: "jiraIssueId is required" }, { status: 400 });
    }

    const today = todayUtc();
    const completionDate = expectedCompletionDate ?? today;

    const [declaration] = await db
      .insert(engineerWorkDeclarations)
      .values({
        engineerEmail: user.email,
        jiraIssueId,
        declaredDate: today,
        expectedCompletionDate: completionDate,
      })
      .onConflictDoNothing()
      .returning();

    if (!declaration) {
      return NextResponse.json({ error: "Already declared for today" }, { status: 409 });
    }

    const [issue] = await db
      .select({
        jiraKey: jiraIssues.jiraKey,
        summary: jiraIssues.summary,
        status: jiraIssues.status,
        statusCategory: jiraIssues.statusCategory,
        priority: jiraIssues.priority,
        projectName: jiraProjects.name,
        projectKey: jiraProjects.jiraProjectKey,
      })
      .from(jiraIssues)
      .innerJoin(jiraProjects, eq(jiraProjects.id, jiraIssues.projectId))
      .where(eq(jiraIssues.id, jiraIssueId));

    return NextResponse.json({ ...declaration, ...issue }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
