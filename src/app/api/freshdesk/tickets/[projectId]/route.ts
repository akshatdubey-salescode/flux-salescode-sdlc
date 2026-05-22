import { NextResponse } from "next/server";
import {
  and, or, eq, ilike, sql, isNull, isNotNull,
  desc, asc, gte, lt, gt, not, inArray, getTableColumns,
  type SQL,
} from "drizzle-orm";
import { requireAuth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { freshdeskTickets, jiraIssues, jiraProjects } from "@/lib/db/schema";

const DEFAULT_PAGE_SIZE = 25;

export async function GET(
  req: Request,
  props: { params: Promise<{ projectId: string }> }
) {
  await requireAuth();
  const { projectId } = await props.params;
  const sp = new URL(req.url).searchParams;

  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const pageSize = Math.min(10000, Math.max(1, parseInt(sp.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10)));
  const search = sp.get("search") ?? "";
  const fdStatus = sp.get("fdStatus") ?? "";
  const fdPriority = sp.get("fdPriority") ?? "";
  const ticketType = sp.get("ticketType") ?? "";
  const jiraLink = sp.get("jiraLink") ?? "all";
  const jiraStatus = sp.get("jiraStatus") ?? "";
  const jiraAssignee = sp.get("jiraAssignee") ?? "";
  const jiraPriority = sp.get("jiraPriority") ?? "";
  const sla = sp.get("sla") ?? "all";
  const escalated = sp.get("escalated") ?? "";
  const sort = sp.get("sort") ?? "newest";
  const dateRange = sp.get("dateRange") ?? "all";

  const [project] = await db
    .select({ jiraBaseUrl: jiraProjects.jiraBaseUrl })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, projectId))
    .limit(1);

  // Build WHERE conditions
  const conditions: (SQL | undefined)[] = [eq(freshdeskTickets.projectId, projectId)];

  if (dateRange !== "all") {
    const days = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 90;
    conditions.push(gte(freshdeskTickets.fdCreatedAt, new Date(Date.now() - days * 86_400_000)));
  }

  if (search) {
    conditions.push(
      or(
        ilike(freshdeskTickets.subject, `%${search}%`),
        sql`${freshdeskTickets.fdTicketId}::text like ${`%${search}%`}`
      )
    );
  }

  if (fdStatus) conditions.push(eq(freshdeskTickets.fdStatus, parseInt(fdStatus, 10)));
  if (fdPriority) conditions.push(eq(freshdeskTickets.fdPriority, parseInt(fdPriority, 10)));
  if (ticketType) conditions.push(eq(freshdeskTickets.ticketType, ticketType));

  if (jiraLink === "linked") conditions.push(isNotNull(freshdeskTickets.linkedJiraKey));
  else if (jiraLink === "unlinked") conditions.push(isNull(freshdeskTickets.linkedJiraKey));

  if (jiraStatus) conditions.push(eq(freshdeskTickets.linkedJiraStatus, jiraStatus));
  if (jiraAssignee) conditions.push(eq(freshdeskTickets.linkedJiraAssigneeName, jiraAssignee));
  if (jiraPriority) conditions.push(eq(jiraIssues.priority, jiraPriority));

  if (sla === "breached") {
    conditions.push(
      and(
        isNotNull(freshdeskTickets.dueBy),
        lt(freshdeskTickets.dueBy, new Date()),
        not(inArray(freshdeskTickets.fdStatus, [4, 5]))
      )
    );
  } else if (sla === "at_risk") {
    const now = new Date();
    const fourHoursFromNow = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    conditions.push(
      and(
        isNotNull(freshdeskTickets.dueBy),
        gt(freshdeskTickets.dueBy, now),
        lt(freshdeskTickets.dueBy, fourHoursFromNow),
        not(inArray(freshdeskTickets.fdStatus, [4, 5]))
      )
    );
  }

  if (escalated === "yes") conditions.push(eq(freshdeskTickets.isEscalated, true));

  const whereClause = and(...conditions);

  // ORDER BY
  const orderBy =
    sort === "oldest"   ? asc(freshdeskTickets.fdCreatedAt) :
    sort === "priority" ? desc(freshdeskTickets.fdPriority) :
    sort === "days"     ? asc(freshdeskTickets.fdCreatedAt) :
    sort === "response" ? sql`(${jiraIssues.jiraCreatedAt} - ${freshdeskTickets.fdCreatedAt}) desc nulls last` :
    desc(freshdeskTickets.fdCreatedAt);

  const [countResult, tickets] = await Promise.all([
    db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(freshdeskTickets)
      .leftJoin(jiraIssues, eq(freshdeskTickets.linkedJiraIssueId, jiraIssues.id))
      .where(whereClause),
    db
      .select({
        ...getTableColumns(freshdeskTickets),
        jiraCreatedAt: jiraIssues.jiraCreatedAt,
        jiraPriority: jiraIssues.priority,
      })
      .from(freshdeskTickets)
      .leftJoin(jiraIssues, eq(freshdeskTickets.linkedJiraIssueId, jiraIssues.id))
      .where(whereClause)
      .orderBy(orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ]);

  return NextResponse.json({
    tickets,
    total: countResult[0]?.count ?? 0,
    page,
    pageSize,
    jiraBaseUrl: project?.jiraBaseUrl ?? null,
  });
}
