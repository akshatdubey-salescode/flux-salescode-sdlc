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
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { jiraIssues, jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

type ProjectIssueFilters = {
  q: string;
  statusList: string[];
  priorityList: string[];
  assigneeList: string[];
  reporterList: string[];
  issueTypeList: string[];
  labelsList: string[];
  dateFrom: string;
  dateTo: string;
  sortBy: string;
  sortDir: string;
  pageSize: number;
  page: number;
};

function buildOrderExpr(sortBy: string, sortDir: string) {
  const isAsc = sortDir === "asc";
  switch (sortBy) {
    case "created":
      return isAsc ? asc(jiraIssues.jiraCreatedAt) : desc(jiraIssues.jiraCreatedAt);
    case "priority":
      return isAsc
        ? sql`CASE WHEN ${jiraIssues.priority} = 'Highest' THEN 1 WHEN ${jiraIssues.priority} = 'High' THEN 2 WHEN ${jiraIssues.priority} = 'Medium' THEN 3 WHEN ${jiraIssues.priority} = 'Low' THEN 4 WHEN ${jiraIssues.priority} = 'Lowest' THEN 5 ELSE 6 END ASC`
        : sql`CASE WHEN ${jiraIssues.priority} = 'Highest' THEN 1 WHEN ${jiraIssues.priority} = 'High' THEN 2 WHEN ${jiraIssues.priority} = 'Medium' THEN 3 WHEN ${jiraIssues.priority} = 'Low' THEN 4 WHEN ${jiraIssues.priority} = 'Lowest' THEN 5 ELSE 6 END DESC`;
    case "status":
      return isAsc ? asc(jiraIssues.status) : desc(jiraIssues.status);
    default:
      return isAsc ? asc(jiraIssues.jiraUpdatedAt) : desc(jiraIssues.jiraUpdatedAt);
  }
}

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/projects/[id]/issues">
) {
  await requireAuth();
  const { id } = await ctx.params;

  const [project] = await db
    .select({ id: jiraProjects.id })
    .from(jiraProjects)
    .where(and(eq(jiraProjects.id, id), eq(jiraProjects.isActive, true)))
    .limit(1);

  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

  const { searchParams } = req.nextUrl;

  const filters: ProjectIssueFilters = {
    q: searchParams.get("q")?.trim() ?? "",
    statusList: (searchParams.get("status") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    priorityList: (searchParams.get("priority") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    assigneeList: (searchParams.get("assignee") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    reporterList: (searchParams.get("reporter") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    issueTypeList: (searchParams.get("issueType") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    labelsList: (searchParams.get("labels") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    dateFrom: searchParams.get("dateFrom") ?? "",
    dateTo: searchParams.get("dateTo") ?? "",
    sortBy: searchParams.get("sortBy") ?? "updated",
    sortDir: searchParams.get("sortDir") === "asc" ? "asc" : "desc",
    pageSize: Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") ?? "50", 10))),
    page: Math.max(1, parseInt(searchParams.get("page") ?? "1", 10)),
  };

  return Response.json(await fetchProjectIssues(id, filters));
}

async function fetchProjectIssues(projectId: string, filters: ProjectIssueFilters) {
  "use cache";
  cacheLife("minutes");
  cacheTag(`project:${projectId}`);

  const {
    q, statusList, priorityList, assigneeList, reporterList,
    issueTypeList, labelsList, dateFrom, dateTo,
    sortBy, sortDir, pageSize, page,
  } = filters;

  const offset = (page - 1) * pageSize;
  const conditions = [eq(jiraIssues.projectId, projectId)];

  if (q) {
    const searchCondition = or(
      ilike(jiraIssues.jiraKey, `%${q}%`),
      ilike(jiraIssues.summary, `%${q}%`)
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  if (statusList.length) conditions.push(inArray(jiraIssues.status, statusList));
  if (priorityList.length) conditions.push(inArray(jiraIssues.priority, priorityList));
  if (assigneeList.length) {
    const assigneeEmails = sql.join(assigneeList.map((e) => sql`${e}`), sql`, `);
    conditions.push(
      or(
        inArray(jiraIssues.assigneeEmail, assigneeList),
        sql`${jiraIssues.additionalAssigneeEmails} && ARRAY[${assigneeEmails}]::text[]`
      )!
    );
  }
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
  const where = and(...conditions);
  const orderExpr = buildOrderExpr(sortBy, sortDir);

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
      .limit(pageSize)
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
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
