import { type NextRequest, NextResponse } from "next/server";
import { sql, inArray } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { FRESHDESK_CUSTOM_FIELD } from "@/lib/freshdesk/sync";

export type BugCell = {
  ownerKey: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerAccount: string | null;
  projectId: string;
  projectName: string;
  jiraBaseUrl: string;
  jiraProjectKey: string;
  total: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  open: number;
  open1: number;
  open2: number;
  open3: number;
  open4: number;
  cfTotal: number;
  cf1: number;
  cf2: number;
  cf3: number;
  cf4: number;
};

export type BugProject = {
  id: string;
  name: string;
  jiraBaseUrl: string;
  jiraProjectKey: string;
  ownerFieldNumIds: number[];
};

export type BugBoardResponse = {
  cells: BugCell[];
  projects: BugProject[];
  generatedAt: string;
  freshdeskFieldId: number | null;
};

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = request.nextUrl;
    const from = searchParams.get("from") ?? undefined;
    const to = searchParams.get("to") ?? undefined;
    const data = await fetchBugBoard(from, to);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[bugs] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function fetchBugBoard(from?: string, to?: string): Promise<BugBoardResponse> {
  "use cache";
  cacheLife("minutes");
  cacheTag("bugs");

  const fdField = sql.raw(`'${FRESHDESK_CUSTOM_FIELD}'`);
  const fromFilter = from ? sql` AND ji.jira_created_at >= ${from}::date` : sql``;
  const toFilter = to
    ? sql` AND ji.jira_created_at < (${to}::date + interval '1 day')`
    : sql``;

  const res = await db.execute(sql`
    WITH base AS (
      SELECT
        ji.priority,
        ji.status_category,
        jp.id            AS project_id,
        jp.name          AS project_name,
        jp.jira_base_url AS jira_base_url,
        jp.jira_project_key AS jira_project_key,
        (
          ji.custom_fields ? ${fdField}
          AND COALESCE(ji.custom_fields->>${fdField}, '') <> ''
        ) AS is_customer,
        ow.v AS owner_val
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id
      LEFT JOIN LATERAL (
        SELECT ji.custom_fields->f.fid AS v
        FROM unnest(COALESCE(jp.issue_owner_field_ids, '{}'::text[]))
             WITH ORDINALITY AS f(fid, ord)
        WHERE ji.custom_fields ? f.fid
          AND (
            (jsonb_typeof(ji.custom_fields->f.fid) = 'object'
              AND (ji.custom_fields->f.fid) ? 'accountId')
            OR (jsonb_typeof(ji.custom_fields->f.fid) = 'array'
              AND jsonb_array_length(ji.custom_fields->f.fid) > 0)
          )
        ORDER BY f.ord LIMIT 1
      ) ow ON true
      WHERE ji.issue_type = 'Bug'${fromFilter}${toFilter}
    ),
    resolved AS (
      SELECT
        project_id, project_name, jira_base_url, jira_project_key,
        priority, status_category, is_customer,
        COALESCE(owner_val->>'emailAddress', owner_val->0->>'emailAddress') AS owner_email,
        COALESCE(owner_val->>'displayName',  owner_val->0->>'displayName')  AS owner_name,
        COALESCE(owner_val->>'accountId',    owner_val->0->>'accountId')    AS owner_account
      FROM base
    )
    SELECT
      COALESCE(owner_email, owner_account) AS owner_key,
      MAX(owner_name)    AS owner_name,
      MAX(owner_account) AS owner_account,
      owner_email,
      project_id, project_name, jira_base_url, jira_project_key,
      COUNT(*)::int                                                                    AS total,
      COUNT(*) FILTER (WHERE priority = 'P1')::int                                    AS p1,
      COUNT(*) FILTER (WHERE priority = 'P2')::int                                    AS p2,
      COUNT(*) FILTER (WHERE priority = 'P3')::int                                    AS p3,
      COUNT(*) FILTER (WHERE priority = 'P4')::int                                    AS p4,
      COUNT(*) FILTER (WHERE status_category IS DISTINCT FROM 'Done')::int            AS open,
      COUNT(*) FILTER (WHERE status_category IS DISTINCT FROM 'Done' AND priority = 'P1')::int AS open1,
      COUNT(*) FILTER (WHERE status_category IS DISTINCT FROM 'Done' AND priority = 'P2')::int AS open2,
      COUNT(*) FILTER (WHERE status_category IS DISTINCT FROM 'Done' AND priority = 'P3')::int AS open3,
      COUNT(*) FILTER (WHERE status_category IS DISTINCT FROM 'Done' AND priority = 'P4')::int AS open4,
      COUNT(*) FILTER (WHERE is_customer)::int                                         AS cf_total,
      COUNT(*) FILTER (WHERE is_customer AND priority = 'P1')::int                    AS cf1,
      COUNT(*) FILTER (WHERE is_customer AND priority = 'P2')::int                    AS cf2,
      COUNT(*) FILTER (WHERE is_customer AND priority = 'P3')::int                    AS cf3,
      COUNT(*) FILTER (WHERE is_customer AND priority = 'P4')::int                    AS cf4
    FROM resolved
    GROUP BY
      COALESCE(owner_email, owner_account), owner_email,
      project_id, project_name, jira_base_url, jira_project_key
  `);

  const cells: BugCell[] = (res.rows as Record<string, unknown>[]).map((r) => ({
    ownerKey: (r.owner_key as string | null) ?? null,
    ownerName: (r.owner_name as string | null) ?? null,
    ownerEmail: (r.owner_email as string | null) ?? null,
    ownerAccount: (r.owner_account as string | null) ?? null,
    projectId: r.project_id as string,
    projectName: r.project_name as string,
    jiraBaseUrl: r.jira_base_url as string,
    jiraProjectKey: r.jira_project_key as string,
    total: Number(r.total),
    p1: Number(r.p1),
    p2: Number(r.p2),
    p3: Number(r.p3),
    p4: Number(r.p4),
    open: Number(r.open),
    open1: Number(r.open1),
    open2: Number(r.open2),
    open3: Number(r.open3),
    open4: Number(r.open4),
    cfTotal: Number(r.cf_total),
    cf1: Number(r.cf1),
    cf2: Number(r.cf2),
    cf3: Number(r.cf3),
    cf4: Number(r.cf4),
  }));

  const projIds = [...new Set(cells.map((c) => c.projectId))];
  const projects: BugProject[] = [];
  if (projIds.length > 0) {
    const projRows = await db
      .select({
        id: jiraProjects.id,
        name: jiraProjects.name,
        jiraBaseUrl: jiraProjects.jiraBaseUrl,
        jiraProjectKey: jiraProjects.jiraProjectKey,
        issueOwnerFieldIds: jiraProjects.issueOwnerFieldIds,
      })
      .from(jiraProjects)
      .where(inArray(jiraProjects.id, projIds));

    for (const r of projRows) {
      const ownerFieldNumIds = (r.issueOwnerFieldIds ?? [])
        .map((f) => Number(f.replace(/\D/g, "")))
        .filter((n) => Number.isFinite(n) && n > 0);
      projects.push({
        id: r.id,
        name: r.name,
        jiraBaseUrl: r.jiraBaseUrl,
        jiraProjectKey: r.jiraProjectKey,
        ownerFieldNumIds,
      });
    }
    projects.sort((a, b) => a.name.localeCompare(b.name));
  }

  const freshdeskFieldId = FRESHDESK_CUSTOM_FIELD
    ? Number(FRESHDESK_CUSTOM_FIELD.replace(/\D/g, "")) || null
    : null;

  return { cells, projects, generatedAt: new Date().toISOString(), freshdeskFieldId };
}
