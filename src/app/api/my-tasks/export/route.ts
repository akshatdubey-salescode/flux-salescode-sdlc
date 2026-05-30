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

export async function GET(req: NextRequest) {
  const user = await requireAuth();

  const { searchParams } = req.nextUrl;

  const forEmail = searchParams.get("forEmail")?.trim();
  const targetEmail = forEmail || user.email;

  const q = searchParams.get("q")?.trim() ?? "";
  const projectList = (searchParams.get("projects") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const statusList = (searchParams.get("status") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const priorityList = (searchParams.get("priority") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const reporterList = (searchParams.get("reporter") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const issueTypeList = (searchParams.get("issueType") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const labelsList = (searchParams.get("labels") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const showCompleted = searchParams.get("showCompleted") === "true";
  const includeReported = searchParams.get("includeReported") === "true";
  const sortBy = searchParams.get("sortBy") ?? "created";
  const sortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc";

  const assigneeCondition = includeReported
    ? or(
        eq(jiraIssues.assigneeEmail, targetEmail),
        sql`${targetEmail} = ANY(${jiraIssues.additionalAssigneeEmails})`,
        eq(jiraIssues.reporterEmail, targetEmail)
      )!
    : or(
        eq(jiraIssues.assigneeEmail, targetEmail),
        sql`${targetEmail} = ANY(${jiraIssues.additionalAssigneeEmails})`
      )!;

  const conditions = [assigneeCondition];

  if (q) {
    const searchCondition = or(
      ilike(jiraIssues.jiraKey, `%${q}%`),
      ilike(jiraIssues.summary, `%${q}%`)
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  if (projectList.length) conditions.push(inArray(jiraIssues.projectId, projectList));
  if (statusList.length) conditions.push(inArray(jiraIssues.status, statusList));
  if (priorityList.length) conditions.push(inArray(jiraIssues.priority, priorityList));
  if (reporterList.length) conditions.push(inArray(jiraIssues.reporterEmail, reporterList));
  if (issueTypeList.length) conditions.push(inArray(jiraIssues.issueType, issueTypeList));

  if (labelsList.length) {
    const labelsCondition = or(...labelsList.map((label) => sql`${label} = ANY(${jiraIssues.labels})`));
    if (labelsCondition) conditions.push(labelsCondition);
  }

  if (dateFrom) conditions.push(gte(jiraIssues.jiraCreatedAt, new Date(dateFrom)));
  if (dateTo) {
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    conditions.push(lte(jiraIssues.jiraCreatedAt, to));
  }
  if (!showCompleted) {
    conditions.push(
      sql`LOWER(TRIM(${jiraIssues.statusCategory})) NOT IN ('done', 'complete')`
    );
  }

  const where = and(...conditions);

  const isAsc = sortDir === "asc";
  let orderExpr;
  switch (sortBy) {
    case "created":
      orderExpr = isAsc ? asc(jiraIssues.jiraCreatedAt) : desc(jiraIssues.jiraCreatedAt);
      break;
    case "priority":
      orderExpr = isAsc
        ? sql`CASE WHEN ${jiraIssues.priority} = 'Highest' THEN 1 WHEN ${jiraIssues.priority} = 'High' THEN 2 WHEN ${jiraIssues.priority} = 'Medium' THEN 3 WHEN ${jiraIssues.priority} = 'Low' THEN 4 WHEN ${jiraIssues.priority} = 'Lowest' THEN 5 ELSE 6 END ASC`
        : sql`CASE WHEN ${jiraIssues.priority} = 'Highest' THEN 1 WHEN ${jiraIssues.priority} = 'High' THEN 2 WHEN ${jiraIssues.priority} = 'Medium' THEN 3 WHEN ${jiraIssues.priority} = 'Low' THEN 4 WHEN ${jiraIssues.priority} = 'Lowest' THEN 5 ELSE 6 END DESC`;
      break;
    case "status":
      orderExpr = isAsc ? asc(jiraIssues.status) : desc(jiraIssues.status);
      break;
    default:
      orderExpr = isAsc ? asc(jiraIssues.jiraUpdatedAt) : desc(jiraIssues.jiraUpdatedAt);
  }

  const issues = await db
    .select({
      jiraKey: jiraIssues.jiraKey,
      summary: jiraIssues.summary,
      status: jiraIssues.status,
      issueType: jiraIssues.issueType,
      priority: jiraIssues.priority,
      assigneeName: jiraIssues.assigneeName,
      assigneeEmail: jiraIssues.assigneeEmail,
      reporterName: jiraIssues.reporterName,
      reporterEmail: jiraIssues.reporterEmail,
      labels: jiraIssues.labels,
      jiraCreatedAt: jiraIssues.jiraCreatedAt,
      jiraUpdatedAt: jiraIssues.jiraUpdatedAt,
      jiraBaseUrl: jiraProjects.jiraBaseUrl,
    })
    .from(jiraIssues)
    .innerJoin(jiraProjects, eq(jiraIssues.projectId, jiraProjects.id))
    .where(where)
    .orderBy(orderExpr)
    .limit(5000);

  return Response.json({ issues });
}
