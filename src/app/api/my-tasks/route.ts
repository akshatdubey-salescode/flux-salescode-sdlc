import type { NextRequest } from "next/server";
import {
  eq,
  and,
  or,
  ilike,
  desc,
  asc,
  inArray,
  gte,
  lte,
  sql,
} from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraIssues, jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

function buildOrderExpr(sortBy: string, sortDir: string) {
  const isAsc = sortDir === "asc";
  switch (sortBy) {
    case "created":
      return isAsc
        ? asc(jiraIssues.jiraCreatedAt)
        : desc(jiraIssues.jiraCreatedAt);
    case "priority":
      return isAsc
        ? sql`CASE WHEN ${jiraIssues.priority} = 'Highest' THEN 1 WHEN ${jiraIssues.priority} = 'High' THEN 2 WHEN ${jiraIssues.priority} = 'Medium' THEN 3 WHEN ${jiraIssues.priority} = 'Low' THEN 4 WHEN ${jiraIssues.priority} = 'Lowest' THEN 5 ELSE 6 END ASC`
        : sql`CASE WHEN ${jiraIssues.priority} = 'Highest' THEN 1 WHEN ${jiraIssues.priority} = 'High' THEN 2 WHEN ${jiraIssues.priority} = 'Medium' THEN 3 WHEN ${jiraIssues.priority} = 'Low' THEN 4 WHEN ${jiraIssues.priority} = 'Lowest' THEN 5 ELSE 6 END DESC`;
    case "status":
      return isAsc ? asc(jiraIssues.status) : desc(jiraIssues.status);
    case "comments":
      return isAsc
        ? sql`(SELECT COUNT(*) FROM jira_comments WHERE jira_comments.issue_id = ${jiraIssues.id}) ASC`
        : sql`(SELECT COUNT(*) FROM jira_comments WHERE jira_comments.issue_id = ${jiraIssues.id}) DESC`;
    default:
      return isAsc
        ? asc(jiraIssues.jiraUpdatedAt)
        : desc(jiraIssues.jiraUpdatedAt);
  }
}

export async function GET(req: NextRequest) {
  const user = await requireAuth();

  const { searchParams } = req.nextUrl;

  const q = searchParams.get("q")?.trim() ?? "";
  const projectList = (searchParams.get("projects") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const statusList = (searchParams.get("status") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const priorityList = (searchParams.get("priority") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const reporterList = (searchParams.get("reporter") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const issueTypeList = (searchParams.get("issueType") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const labelsList = (searchParams.get("labels") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const hasComments = searchParams.get("hasComments") === "true";
  const showCompleted = searchParams.get("showCompleted") === "true";
  const sortBy = searchParams.get("sortBy") ?? "created";
  const sortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc";
  const pageSize = Math.min(
    200,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? "50", 10))
  );
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const offset = (page - 1) * pageSize;

  const conditions = [eq(jiraIssues.assigneeEmail, user.email)];

  if (q) {
    conditions.push(
      or(
        ilike(jiraIssues.jiraKey, `%${q}%`),
        ilike(jiraIssues.summary, `%${q}%`)
      )!
    );
  }

  if (projectList.length) {
    conditions.push(inArray(jiraIssues.projectId, projectList));
  }
  if (statusList.length) conditions.push(inArray(jiraIssues.status, statusList));
  if (priorityList.length)
    conditions.push(inArray(jiraIssues.priority, priorityList));
  if (reporterList.length)
    conditions.push(inArray(jiraIssues.reporterEmail, reporterList));
  if (issueTypeList.length)
    conditions.push(inArray(jiraIssues.issueType, issueTypeList));

  if (labelsList.length) {
    const labelConditions = labelsList.map(
      (label) => sql`${label} = ANY(${jiraIssues.labels})`
    );
    conditions.push(or(...labelConditions)!);
  }

  if (dateFrom)
    conditions.push(gte(jiraIssues.jiraCreatedAt, new Date(dateFrom)));
  if (dateTo) {
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    conditions.push(lte(jiraIssues.jiraCreatedAt, to));
  }
  if (hasComments) {
    conditions.push(
      sql`(SELECT COUNT(*) FROM jira_comments WHERE jira_comments.issue_id = ${jiraIssues.id}) > 0`
    );
  }
  if (!showCompleted) {
    conditions.push(
      sql`LOWER(TRIM(${jiraIssues.statusCategory})) NOT IN ('done', 'complete')`
    );
  }

  const where = and(...conditions);
  const orderExpr = buildOrderExpr(sortBy, sortDir);

  const commentCount = sql<number>`(SELECT COUNT(*)::int FROM jira_comments WHERE jira_comments.issue_id = ${jiraIssues.id})`;

  const selectFields = {
    id: jiraIssues.id,
    jiraKey: jiraIssues.jiraKey,
    summary: jiraIssues.summary,
    status: jiraIssues.status,
    statusCategory: jiraIssues.statusCategory,
    issueType: jiraIssues.issueType,
    priority: jiraIssues.priority,
    assigneeName: jiraIssues.assigneeName,
    assigneeEmail: jiraIssues.assigneeEmail,
    reporterName: jiraIssues.reporterName,
    reporterEmail: jiraIssues.reporterEmail,
    labels: jiraIssues.labels,
    jiraCreatedAt: jiraIssues.jiraCreatedAt,
    jiraUpdatedAt: jiraIssues.jiraUpdatedAt,
    commentCount,
  };

  const [issues, countResult] = await Promise.all([
    db
      .select(selectFields)
      .from(jiraIssues)
      .where(where)
      .orderBy(orderExpr)
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(jiraIssues)
      .where(where),
  ]);

  const total = countResult[0]?.count ?? 0;

  return Response.json({
    issues,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}
