import type { NextRequest } from "next/server";
import { eq, and, ilike, or, desc, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { jiraIssues } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

const PAGE_SIZE = 25;

export async function GET(req: NextRequest) {
  await requireAuth();

  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q")?.trim() ?? "";
  const projectId = searchParams.get("projectId") ?? "";
  const status = searchParams.get("status") ?? "";
  const assigneeEmail = searchParams.get("assignee") ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));

  return Response.json(await fetchIssues(q, projectId, status, assigneeEmail, page));
}

async function fetchIssues(
  q: string,
  projectId: string,
  status: string,
  assigneeEmail: string,
  page: number
) {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues");

  const offset = (page - 1) * PAGE_SIZE;
  const conditions = [];

  if (projectId) conditions.push(eq(jiraIssues.projectId, projectId));
  if (status) conditions.push(eq(jiraIssues.status, status));
  if (assigneeEmail) conditions.push(eq(jiraIssues.assigneeEmail, assigneeEmail));
  if (q) {
    conditions.push(
      or(
        ilike(jiraIssues.jiraKey, `%${q}%`),
        ilike(jiraIssues.summary, `%${q}%`)
      )
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [issues, countResult] = await Promise.all([
    db
      .select({
        id: jiraIssues.id,
        jiraKey: jiraIssues.jiraKey,
        summary: jiraIssues.summary,
        status: jiraIssues.status,
        statusCategory: jiraIssues.statusCategory,
        issueType: jiraIssues.issueType,
        priority: jiraIssues.priority,
        assigneeName: jiraIssues.assigneeName,
        assigneeEmail: jiraIssues.assigneeEmail,
        projectId: jiraIssues.projectId,
        jiraUpdatedAt: jiraIssues.jiraUpdatedAt,
      })
      .from(jiraIssues)
      .where(where)
      .orderBy(desc(jiraIssues.jiraUpdatedAt))
      .limit(PAGE_SIZE)
      .offset(offset),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(jiraIssues)
      .where(where),
  ]);

  const total = countResult[0]?.count ?? 0;

  return {
    issues,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.ceil(total / PAGE_SIZE),
  };
}
