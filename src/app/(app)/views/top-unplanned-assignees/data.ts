import { cacheLife, cacheTag } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { KEKA_DIRECTORY_TAG } from "@/lib/keka/cache-tags";
import { loadKekaDirectory } from "@/lib/keka/directory";

export type TeamRef = { id: string; name: string };

export type TopUnplannedRow = {
  rank: number;
  email: string;
  name: string;
  unplanned_count: number;
  teams: TeamRef[];
  // Keka org context (null/empty when not a current employee).
  department: string | null;
  managerName: string | null;
  managerChain: string[];
};

type RankRow = {
  rank: number;
  email: string;
  name: string;
  unplanned_count: number;
};

type TeamRow = { email: string; id: string; name: string };

// An issue is "planned" only when it has both a start and a due/end date. These
// detect each across the well-known custom-field IDs plus any project-specific
// field IDs. Shared verbatim by the ranking query and the per-assignee drill-down
// so the list always matches the count it was opened from — edit them in one place.
const HAS_START_EXPR = sql`(
  COALESCE(
    NULLIF(custom_fields->>'customfield_10015',''),
    NULLIF(custom_fields->>'customfield_10014',''),
    NULLIF(custom_fields->>'startdate',''),
    NULLIF(custom_fields->>'start_date','')
  ) IS NOT NULL
  OR (start_date_field_ids IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(start_date_field_ids) fid
    WHERE NULLIF(custom_fields->>fid, '') IS NOT NULL
  ))
)`;

const HAS_DUE_EXPR = sql`(
  COALESCE(
    NULLIF(custom_fields->>'duedate',''),
    NULLIF(custom_fields->>'due_date',''),
    NULLIF(custom_fields->>'customfield_10021',''),
    NULLIF(custom_fields->>'end_date',''),
    NULLIF(custom_fields->>'customfield_11449','')
  ) IS NOT NULL
  OR (end_date_field_ids IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(end_date_field_ids) fid
    WHERE NULLIF(custom_fields->>fid, '') IS NOT NULL
  ))
)`;

export async function fetchTopUnplannedAssignees(
  start: string,
  end: string,
  includeCompleted: boolean = false
): Promise<TopUnplannedRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues");
  cacheTag("boards");
  cacheTag(KEKA_DIRECTORY_TAG);

  const excludeDoneCondition = includeCompleted
    ? sql`TRUE`
    : sql`(psm.canonical_status IS NULL OR psm.canonical_status != 'DONE')`;

  const ranked = await db.execute(sql`
    WITH all_assignments AS (
      SELECT
        ji.id,
        lower(ji.assignee_email) AS email,
        ji.assignee_name AS name,
        ji.custom_fields,
        jp.end_date_field_ids,
        jp.start_date_field_ids
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id
      LEFT JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
      WHERE ji.assignee_email IS NOT NULL AND trim(ji.assignee_email) != ''
        AND ji.jira_created_at::date >= ${start}::date
        AND ji.jira_created_at::date <= ${end}::date
        -- Grace window: only count issues the person has owned for ≥24h, so
        -- freshly-assigned work isn't flagged as "unplanned" before they've
        -- had a chance to plan it. Falls back to creation time pre-backfill.
        AND COALESCE(ji.assignee_since, ji.jira_created_at)
            <= now() - interval '24 hours'
        AND ${excludeDoneCondition}
    ),
    classified AS (
      SELECT
        id, email, name,
        ${HAS_START_EXPR} AS has_start,
        ${HAS_DUE_EXPR} AS has_due
      FROM all_assignments
    ),
    unplanned AS (
      SELECT DISTINCT id, email
      FROM classified
      WHERE NOT (has_start AND has_due)
    ),
    ranked AS (
      SELECT
        u.email,
        (
          SELECT MAX(c.name)
          FROM classified c
          WHERE c.email = u.email AND c.name IS NOT NULL
        ) AS name,
        COUNT(*)::int AS unplanned_count
      FROM unplanned u
      GROUP BY u.email
    )
    SELECT
      ROW_NUMBER() OVER (ORDER BY unplanned_count DESC)::int AS rank,
      email,
      COALESCE(name, '(unknown)') AS name,
      unplanned_count
    FROM ranked
    ORDER BY unplanned_count DESC
    LIMIT 30
  `);

  const topRows = ranked.rows as RankRow[];
  if (topRows.length === 0) return [];

  const emails = topRows.map((r) => r.email);
  const emailsIn = sql.join(emails.map((e) => sql`${e}`), sql`, `);

  const boards = await db.execute(sql`
    SELECT lower(obm.email) AS email, ob.id::text AS id, ob.name
    FROM observer_board_members obm
    JOIN observer_boards ob ON ob.id = obm.board_id
    WHERE lower(obm.email) IN (${emailsIn})
    UNION
    SELECT lower(ob.manager_email) AS email, ob.id::text AS id, ob.name
    FROM observer_boards ob
    WHERE ob.manager_email IS NOT NULL
      AND lower(ob.manager_email) IN (${emailsIn})
  `);

  const teamsByEmail = new Map<string, TeamRef[]>();
  for (const row of boards.rows as TeamRow[]) {
    const list = teamsByEmail.get(row.email) ?? [];
    list.push({ id: row.id, name: row.name });
    teamsByEmail.set(row.email, list);
  }

  const dir = await loadKekaDirectory();
  return topRows.map((r) => {
    const e = dir.get(r.email);
    return {
      ...r,
      name: e?.displayName ?? r.name,
      teams: teamsByEmail.get(r.email) ?? [],
      department: e?.department ?? null,
      managerName: e?.managerName ?? null,
      managerChain: dir.managerChain(r.email),
    };
  });
}

export type UnplannedIssue = {
  id: string;
  jira_key: string;
  summary: string;
  browse_url: string;
  status: string | null;
  jira_created_at: string;
  assigned_at: string | null;
};

export type UnplannedDetail = {
  name: string;
  email: string;
  issues: UnplannedIssue[];
};

type IssueRow = UnplannedIssue & { name: string | null };

/**
 * Drill-down: every issue counted as unplanned for a single assignee in the
 * window, most recent first. Reproduces the exact classification used by
 * fetchTopUnplannedAssignees (grace window, start/due detection, optional done
 * exclusion) so this list always matches the count it was opened from. Capped
 * at 2000 rows, comfortably above any single assignee's quarterly count.
 */
export async function fetchUnplannedIssuesForAssignee(
  email: string,
  start: string,
  end: string,
  includeCompleted: boolean = false
): Promise<UnplannedDetail> {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues");

  const excludeDoneCondition = includeCompleted
    ? sql`TRUE`
    : sql`(psm.canonical_status IS NULL OR psm.canonical_status != 'DONE')`;

  const res = await db.execute(sql`
    WITH all_assignments AS (
      SELECT
        ji.id,
        ji.jira_key,
        ji.summary,
        ji.status,
        ji.jira_created_at,
        ji.assignee_since AS assigned_at,
        ji.assignee_name AS name,
        rtrim(jp.jira_base_url, '/') || '/browse/' || ji.jira_key AS browse_url,
        ji.custom_fields,
        jp.end_date_field_ids,
        jp.start_date_field_ids
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id
      LEFT JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
      WHERE lower(ji.assignee_email) = ${email}
        AND ji.jira_created_at::date >= ${start}::date
        AND ji.jira_created_at::date <= ${end}::date
        -- Same grace window as the ranking query: only issues owned for ≥24h.
        AND COALESCE(ji.assignee_since, ji.jira_created_at)
            <= now() - interval '24 hours'
        AND ${excludeDoneCondition}
    ),
    classified AS (
      SELECT
        id, jira_key, summary, status, jira_created_at, assigned_at, name, browse_url,
        ${HAS_START_EXPR} AS has_start,
        ${HAS_DUE_EXPR} AS has_due
      FROM all_assignments
    ),
    unplanned AS (
      -- DISTINCT (id is unique) collapses any fan-out from the status-mapping
      -- join, so this list matches the ranking query's COUNT(DISTINCT id).
      SELECT DISTINCT
        id, jira_key, summary, status, jira_created_at, assigned_at, name, browse_url
      FROM classified
      WHERE NOT (has_start AND has_due)
    )
    SELECT
      id, jira_key, summary, status, jira_created_at, assigned_at, name, browse_url
    FROM unplanned
    ORDER BY jira_created_at DESC
    LIMIT 2000
  `);

  const rows = res.rows as IssueRow[];

  return {
    name: rows[0]?.name ?? "(unknown)",
    email,
    issues: rows.map((r) => ({
      id: r.id,
      jira_key: r.jira_key,
      summary: r.summary,
      browse_url: r.browse_url,
      status: r.status,
      jira_created_at: r.jira_created_at,
      assigned_at: r.assigned_at,
    })),
  };
}
