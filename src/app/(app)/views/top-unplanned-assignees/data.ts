import { cacheLife, cacheTag } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export type TeamRef = { id: string; name: string };

export type TopUnplannedRow = {
  rank: number;
  email: string;
  name: string;
  unplanned_count: number;
  teams: TeamRef[];
};

type RankRow = {
  rank: number;
  email: string;
  name: string;
  unplanned_count: number;
};

type TeamRow = { email: string; id: string; name: string };

export async function fetchTopUnplannedAssignees(
  start: string,
  end: string,
  includeCompleted: boolean = false
): Promise<TopUnplannedRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues");
  cacheTag("boards");

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
        AND ${excludeDoneCondition}
      UNION ALL
      SELECT
        ji.id,
        lower(ae) AS email,
        NULL AS name,
        ji.custom_fields,
        jp.end_date_field_ids,
        jp.start_date_field_ids
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id
      LEFT JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id AND psm.raw_status = ji.status,
      LATERAL unnest(ji.additional_assignee_emails) AS ae
      WHERE ae IS NOT NULL AND trim(ae) != ''
        AND ji.jira_created_at::date >= ${start}::date
        AND ji.jira_created_at::date <= ${end}::date
        AND ${excludeDoneCondition}
    ),
    classified AS (
      SELECT
        id, email, name,
        (
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
        ) AS has_start,
        (
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
        ) AS has_due
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
    LIMIT 15
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

  return topRows.map((r) => ({
    ...r,
    teams: teamsByEmail.get(r.email) ?? [],
  }));
}
