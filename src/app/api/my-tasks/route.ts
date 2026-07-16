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
  type SQL,
} from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { jiraIssues, jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { stampCache, withCacheMetrics, type Stamped } from "@/lib/cache/metrics";
import { extractStartDate, extractDueDate } from "@/lib/jira/dates";
import {
  hasStartDateSql,
  hasDueDateSql,
  startDateValueSql,
  dueDateValueSql,
} from "@/lib/jira/planned-sql";

/** Issue is "planned" only with both a start and a due/end date set. */
const UNPLANNED_EXPR = sql`NOT (${hasStartDateSql(
  jiraIssues.customFields,
  jiraProjects.startDateFieldIds
)} AND ${hasDueDateSql(jiraIssues.customFields, jiraProjects.endDateFieldIds)})`;

type MyTaskFilters = {
  q: string;
  projectList: string[];
  statusList: string[];
  priorityList: string[];
  reporterList: string[];
  issueTypeList: string[];
  labelsList: string[];
  dateFrom: string;
  dateTo: string;
  showCompleted: boolean;
  includeReported: boolean;
  unplannedOnly: boolean;
  sortBy: string;
  sortDir: string;
  pageSize: number;
  page: number;
};

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
    case "planned": {
      // Order by planned-ness (false < true). asc → unplanned first.
      const planned = sql`(${hasStartDateSql(
        jiraIssues.customFields,
        jiraProjects.startDateFieldIds
      )} AND ${hasDueDateSql(jiraIssues.customFields, jiraProjects.endDateFieldIds)})`;
      return isAsc ? sql`${planned} ASC` : sql`${planned} DESC`;
    }
    default:
      return isAsc
        ? asc(jiraIssues.jiraUpdatedAt)
        : desc(jiraIssues.jiraUpdatedAt);
  }
}

export async function GET(req: NextRequest) {
  const user = await requireAuth();

  const { searchParams } = req.nextUrl;

  const forEmail = searchParams.get("forEmail")?.trim();
  const targetEmail = forEmail || user.email;

  const filters: MyTaskFilters = {
    q: searchParams.get("q")?.trim() ?? "",
    projectList: (searchParams.get("projects") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    statusList: (searchParams.get("status") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    priorityList: (searchParams.get("priority") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    reporterList: (searchParams.get("reporter") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    issueTypeList: (searchParams.get("issueType") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    labelsList: (searchParams.get("labels") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    dateFrom: searchParams.get("dateFrom") ?? "",
    dateTo: searchParams.get("dateTo") ?? "",
    showCompleted: searchParams.get("showCompleted") === "true",
    includeReported: searchParams.get("includeReported") === "true",
    unplannedOnly: searchParams.get("unplannedOnly") === "true",
    sortBy: searchParams.get("sortBy") ?? "created",
    sortDir: searchParams.get("sortDir") === "asc" ? "asc" : "desc",
    pageSize: Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") ?? "50", 10))),
    page: Math.max(1, parseInt(searchParams.get("page") ?? "1", 10)),
  };

  const { data, headers } = await withCacheMetrics("my-tasks", () =>
    fetchMyTasks(targetEmail, filters)
  );
  return Response.json(data, { headers });
}

async function fetchMyTasks(
  targetEmail: string,
  filters: MyTaskFilters
): Promise<Stamped<unknown>> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`my-tasks:${targetEmail}`);

  const {
    q, projectList, statusList, priorityList, reporterList,
    issueTypeList, labelsList, dateFrom, dateTo,
    showCompleted, includeReported, unplannedOnly, sortBy, sortDir, pageSize, page,
  } = filters;

  const offset = (page - 1) * pageSize;
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

  // Quarter / date-range filter. A task belongs to the [dateFrom, dateTo]
  // window when its PLANNED window (start date → due date) OVERLAPS it —
  // start ≤ window end AND due ≥ window start — so a task planned for this
  // period shows here regardless of when its ticket was created, and one that
  // straddles a quarter boundary shows in both quarters it spans. Tasks without
  // both a start and a due date have no plan to place, so they fall back to the
  // prior behavior: their creation date must fall in the window. This keeps
  // undated tickets from silently disappearing from a quarter view.
  if (dateFrom || dateTo) {
    const startVal = startDateValueSql(
      jiraIssues.customFields,
      jiraProjects.startDateFieldIds
    );
    const dueVal = dueDateValueSql(
      jiraIssues.customFields,
      jiraProjects.endDateFieldIds
    );

    const overlap: SQL[] = [
      sql`${startVal} IS NOT NULL`,
      sql`${dueVal} IS NOT NULL`,
    ];
    if (dateTo) overlap.push(sql`${startVal} <= ${dateTo}::date`);
    if (dateFrom) overlap.push(sql`${dueVal} >= ${dateFrom}::date`);

    const fallback: SQL[] = [sql`(${startVal} IS NULL OR ${dueVal} IS NULL)`];
    if (dateFrom) fallback.push(gte(jiraIssues.jiraCreatedAt, new Date(dateFrom)));
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      fallback.push(lte(jiraIssues.jiraCreatedAt, to));
    }

    conditions.push(or(and(...overlap)!, and(...fallback)!)!);
  }
  if (!showCompleted) {
    conditions.push(
      sql`LOWER(TRIM(${jiraIssues.statusCategory})) NOT IN ('done', 'complete')`
    );
  }
  if (unplannedOnly) conditions.push(UNPLANNED_EXPR);

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
        customFields: jiraIssues.customFields,
        startDateFieldIds: jiraProjects.startDateFieldIds,
        endDateFieldIds: jiraProjects.endDateFieldIds,
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
      // Joined because `where` (unplanned filter / planned sort) references project columns.
      .innerJoin(jiraProjects, eq(jiraIssues.projectId, jiraProjects.id))
      .where(where),
  ]);

  const total = countResult[0]?.count ?? 0;

  // Derive planned-ness for display; drop the raw fields used to compute it.
  const processed = issues.map(
    ({ customFields, startDateFieldIds, endDateFieldIds, ...rest }) => {
      const cf = (customFields ?? {}) as Record<string, unknown>;
      const startDate = extractStartDate(cf, startDateFieldIds);
      const dueDate = extractDueDate(cf, endDateFieldIds);
      return { ...rest, startDate, dueDate, isPlanned: !!startDate && !!dueDate };
    }
  );

  return stampCache({
    issues: processed,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}
