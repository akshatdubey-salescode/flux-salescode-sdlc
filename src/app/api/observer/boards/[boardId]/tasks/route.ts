import { NextResponse } from "next/server";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers, jiraIssues, jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

type Params = { params: Promise<{ boardId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const user = await requireAuth();
    const { boardId } = await params;

    const [board] = await db
      .select({ id: observerBoards.id })
      .from(observerBoards)
      .where(and(eq(observerBoards.id, boardId), eq(observerBoards.createdBy, user.id)));

    if (!board) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const members = await db
      .select()
      .from(observerBoardMembers)
      .where(eq(observerBoardMembers.boardId, boardId));

    if (members.length === 0) {
      return NextResponse.json([]);
    }

    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const memberEmails = members.map((m) => m.email);

    const issueConditions = [inArray(jiraIssues.assigneeEmail, memberEmails)];

    if (from) {
      issueConditions.push(gte(jiraIssues.jiraUpdatedAt, new Date(from)));
    }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      issueConditions.push(lte(jiraIssues.jiraUpdatedAt, toDate));
    }

    const issues = await db
      .select({
        id: jiraIssues.id,
        jiraKey: jiraIssues.jiraKey,
        summary: jiraIssues.summary,
        status: jiraIssues.status,
        statusCategory: jiraIssues.statusCategory,
        issueType: jiraIssues.issueType,
        priority: jiraIssues.priority,
        assigneeEmail: jiraIssues.assigneeEmail,
        assigneeName: jiraIssues.assigneeName,
        jiraUpdatedAt: jiraIssues.jiraUpdatedAt,
        jiraCreatedAt: jiraIssues.jiraCreatedAt,
        projectId: jiraIssues.projectId,
        projectName: jiraProjects.name,
        projectKey: jiraProjects.jiraProjectKey,
      })
      .from(jiraIssues)
      .innerJoin(jiraProjects, eq(jiraProjects.id, jiraIssues.projectId))
      .where(and(...issueConditions));

    // Group by member email
    const memberMap = new Map(members.map((m) => [m.email, m]));
    const grouped: Record<
      string,
      {
        member: (typeof members)[0];
        issues: typeof issues;
        statusCounts: Record<string, number>;
      }
    > = {};

    for (const m of members) {
      grouped[m.email] = { member: m, issues: [], statusCounts: {} };
    }

    for (const issue of issues) {
      const email = issue.assigneeEmail;
      if (!email || !grouped[email]) continue;
      grouped[email].issues.push(issue);
      const cat = issue.statusCategory ?? issue.status ?? "Unknown";
      grouped[email].statusCounts[cat] = (grouped[email].statusCounts[cat] ?? 0) + 1;
    }

    return NextResponse.json(Object.values(grouped));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
