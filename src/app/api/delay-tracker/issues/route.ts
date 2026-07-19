import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cacheLife, cacheTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";
import { categoryLabel } from "@/lib/delay-tracker/categories";
import { isValidUuid, isValidDateString } from "@/lib/delay-tracker/entries";
import { delayReasonCategoryEnum } from "@/lib/db/schema";

const VALID_CATEGORIES = new Set<string>(delayReasonCategoryEnum.enumValues);
const MAX_ISSUES = 500;

export type DelayedIssueRow = {
  id: string;
  jiraKey: string;
  summary: string;
  projectName: string;
  jiraUrl: string;
  category: string;
  categoryLabel: string;
  delayDate: string;
  responsibleEmail: string | null;
  responsibleName: string | null;
};

export type DelayedIssuesResponse = { issues: DelayedIssueRow[]; truncated: boolean };

/**
 * The delayed issues behind an analytics drill-down — same "click an
 * analytics number, see the issues" shape as /api/analytics/overview/issues.
 * Every filter is optional and combinable (comma-separated for the
 * multi-selects); with none set, returns every active delayed issue
 * (the "click the card header" / "all delays, grouped by person" view).
 */
export async function GET(request: Request) {
  try {
    await requireAuth();
    const url = new URL(request.url);
    const projectIds = (url.searchParams.get("projectIds") ?? "").split(",").filter(Boolean);
    const categories = (url.searchParams.get("categories") ?? "").split(",").filter(Boolean);
    const responsibleEmail = url.searchParams.get("responsibleEmail");
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");

    if (!projectIds.every(isValidUuid)) {
      return NextResponse.json({ error: "every projectId must be a valid UUID" }, { status: 400 });
    }
    if (!categories.every((c) => VALID_CATEGORIES.has(c))) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
    if (dateFrom && !isValidDateString(dateFrom)) {
      return NextResponse.json({ error: "dateFrom must be a valid YYYY-MM-DD date" }, { status: 400 });
    }
    if (dateTo && !isValidDateString(dateTo)) {
      return NextResponse.json({ error: "dateTo must be a valid YYYY-MM-DD date" }, { status: 400 });
    }

    const data = await fetchDelayedIssues({ projectIds, categories, responsibleEmail, dateFrom, dateTo });
    return NextResponse.json(data);
  } catch (error) {
    console.error("Delayed issues error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

async function fetchDelayedIssues(filter: {
  projectIds: string[];
  categories: string[];
  responsibleEmail: string | null;
  dateFrom: string | null;
  dateTo: string | null;
}): Promise<DelayedIssuesResponse> {
  "use cache";
  cacheLife("minutes");
  cacheTag("delay-logs");

  const { projectIds, categories, responsibleEmail, dateFrom, dateTo } = filter;
  const conditions = [sql`dl.deleted_at IS NULL`];
  if (projectIds.length > 0) {
    conditions.push(sql`dl.project_id IN (${sql.join(projectIds.map((id) => sql`${id}`), sql`, `)})`);
  }
  if (categories.length > 0) {
    conditions.push(sql`dl.category IN (${sql.join(categories.map((c) => sql`${c}`), sql`, `)})`);
  }
  if (responsibleEmail) conditions.push(sql`lower(dl.responsible_email) = lower(${responsibleEmail})`);
  if (dateFrom) conditions.push(sql`dl.delay_date >= ${dateFrom}`);
  if (dateTo) conditions.push(sql`dl.delay_date <= ${dateTo}`);

  const res = await db.execute(sql`
    SELECT
      ji.id, ji.jira_key, ji.summary,
      jp.name AS project_name, jp.jira_base_url,
      dl.category, dl.delay_date, dl.responsible_email, dl.responsible_name
    FROM delay_logs dl
    JOIN jira_issues ji ON ji.id = dl.issue_id
    JOIN jira_projects jp ON jp.id = dl.project_id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY dl.delay_date DESC, dl.created_at DESC
    LIMIT ${MAX_ISSUES + 1}
  `);

  const rows = res.rows as Record<string, unknown>[];
  const truncated = rows.length > MAX_ISSUES;
  const issues: DelayedIssueRow[] = rows.slice(0, MAX_ISSUES).map((r) => ({
    id: r.id as string,
    jiraKey: r.jira_key as string,
    summary: r.summary as string,
    projectName: r.project_name as string,
    jiraUrl: `${(r.jira_base_url as string).replace(/\/$/, "")}/browse/${r.jira_key}`,
    category: r.category as string,
    categoryLabel: categoryLabel(r.category as string),
    delayDate: r.delay_date as string,
    responsibleEmail: (r.responsible_email as string | null) ?? null,
    responsibleName: (r.responsible_name as string | null) ?? null,
  }));

  return { issues, truncated };
}
