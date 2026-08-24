import { type NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/server";
import { BUG_ISSUE_TYPES, BUG_INVALID_STATUSES } from "@/lib/scorecard/config";
import { currentFiscalQuarterChip } from "@/lib/date-utils";

// Individual, linkable bug rows for one project (or the no-owner bucket) —
// the reliable alternative to jiraOwnerBugLink's generated JQL (aggregate.ts),
// which compares a custom field directly against a raw Jira accountId and
// silently mismatches for most people (Jira's JQL engine generally can't
// resolve a custom user-picker field against an opaque accountId string the
// way it can for system fields like assignee). This route instead reads our
// own already-synced jira_issues directly — no JQL, no query-syntax
// fragility, just a straight SQL join — and returns issue keys the client
// links to (base URL + key), never a generated search.
//
// The bug population definition here MUST stay in sync with fetchBugBoard in
// /api/bugs/route.ts (issue types, invalid statuses, date range semantics) —
// duplicated rather than shared since the two queries diverge in shape
// (aggregated cells vs individual rows) enough that a shared SQL fragment
// would obscure more than it'd save.
//
// ownerKey additionally scopes the list to one developer — opened from a
// developer's own Project Breakdown row, this must show only the bugs
// counted under THEM for that project, never every bug on the project. It
// resolves the same owner-field LATERAL join and COALESCE(email, accountId)
// precedence as owner_key in fetchBugBoard, so the two stay pointing at
// exactly the same person.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 500;

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = request.nextUrl;

    const projectId = searchParams.get("projectId");
    const unassignedOnly = searchParams.get("unassignedOnly") === "true";
    const priority = searchParams.get("priority");
    const ownerKey = searchParams.get("ownerKey");
    if (!projectId && !unassignedOnly) {
      return NextResponse.json({ error: "projectId or unassignedOnly is required" }, { status: 400 });
    }

    const q = currentFiscalQuarterChip();
    const rawFrom = searchParams.get("from");
    const rawTo = searchParams.get("to");
    const from = rawFrom && ISO_DATE.test(rawFrom) ? rawFrom : q?.start;
    const to = rawTo && ISO_DATE.test(rawTo) ? rawTo : q?.end;

    const rows = await fetchBugIssues({ projectId, unassignedOnly, priority, ownerKey, from, to });
    return NextResponse.json({ issues: rows, truncated: rows.length >= MAX_ROWS });
  } catch (err) {
    console.error("[bugs/issues] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export type BugIssueRow = {
  jiraKey: string;
  summary: string;
  priority: string | null;
  status: string;
  statusCategory: string | null;
  projectName: string;
  jiraBaseUrl: string;
};

async function fetchBugIssues({
  projectId,
  unassignedOnly,
  priority,
  ownerKey,
  from,
  to,
}: {
  projectId: string | null;
  unassignedOnly: boolean;
  priority: string | null;
  ownerKey: string | null;
  from?: string;
  to?: string;
}): Promise<BugIssueRow[]> {
  const bugTypes = sql.join([...BUG_ISSUE_TYPES].map((t) => sql`${t}`), sql`, `);
  const invalidStatuses = sql.join([...BUG_INVALID_STATUSES].map((s) => sql`${s}`), sql`, `);
  const apostropheClass = "['’`]";

  const fromFilter = from ? sql` AND ji.jira_created_at >= ${from}::date` : sql``;
  const toFilter = to ? sql` AND ji.jira_created_at < (${to}::date + interval '1 day')` : sql``;
  const projectFilter = projectId ? sql` AND jp.id = ${projectId}` : sql``;
  const priorityFilter = priority ? sql` AND ji.priority = ${priority}` : sql``;
  // Mirrors the owner-resolution LATERAL join in fetchBugBoard (/api/bugs) —
  // a project's candidate owner-field IDs, first populated one wins. No
  // populated field anywhere = genuinely unassigned.
  const unassignedFilter = unassignedOnly
    ? sql`
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(jp.issue_owner_field_ids, '{}'::text[])) AS fid
        WHERE ji.custom_fields ? fid
          AND (
            (jsonb_typeof(ji.custom_fields->fid) = 'object'
              AND (ji.custom_fields->fid) ? 'accountId')
            OR (jsonb_typeof(ji.custom_fields->fid) = 'array'
              AND jsonb_array_length(ji.custom_fields->fid) > 0)
          )
      )
    `
    : sql``;
  // Same COALESCE(email, accountId) precedence as owner_key in /api/bugs, so
  // one developer's row here links to exactly the issues counted under them
  // there — not every bug on the project.
  const ownerFilter = ownerKey
    ? sql`
      AND COALESCE(
        COALESCE(ow.v->>'emailAddress', ow.v->0->>'emailAddress'),
        COALESCE(ow.v->>'accountId',    ow.v->0->>'accountId')
      ) = ${ownerKey}
    `
    : sql``;

  const res = await db.execute(sql`
    SELECT
      ji.jira_key AS jira_key,
      ji.summary AS summary,
      ji.priority AS priority,
      ji.status AS status,
      ji.status_category AS status_category,
      jp.name AS project_name,
      jp.jira_base_url AS jira_base_url
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
    WHERE lower(trim(ji.issue_type)) IN (${bugTypes})
      AND btrim(lower(regexp_replace(
            regexp_replace(ji.status, ${apostropheClass}, '', 'g'),
            '\s+', ' ', 'g'
          ))) NOT IN (${invalidStatuses})
      ${fromFilter}${toFilter}${projectFilter}${priorityFilter}${unassignedFilter}${ownerFilter}
    ORDER BY
      CASE ji.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 ELSE 5 END,
      ji.jira_created_at DESC
    LIMIT ${MAX_ROWS}
  `);

  return (res.rows as Record<string, unknown>[]).map((r) => ({
    jiraKey: r.jira_key as string,
    summary: r.summary as string,
    priority: (r.priority as string | null) ?? null,
    status: r.status as string,
    statusCategory: (r.status_category as string | null) ?? null,
    projectName: r.project_name as string,
    jiraBaseUrl: r.jira_base_url as string,
  }));
}
