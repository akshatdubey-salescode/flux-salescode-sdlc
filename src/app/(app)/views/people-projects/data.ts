import { cacheLife, cacheTag } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { KEKA_DIRECTORY_TAG } from "@/lib/keka/cache-tags";
import { loadKekaDirectory } from "@/lib/keka/directory";

export type PersonProject = {
  projectId: string;
  projectName: string;
  projectKey: string;
  issueCount: number;
  openCount: number;
  completedInWindow: number;
};

export type PersonProjectsRow = {
  email: string;
  name: string;
  department: string | null;
  jobTitle: string | null;
  managerName: string | null;
  projects: PersonProject[];
  totalIssues: number;
  totalOpen: number;
};

type PairRow = {
  email: string;
  name: string | null;
  project_id: string;
  project_name: string;
  project_key: string;
  issue_count: number;
  open_count: number;
  completed_in_window: number;
};

/**
 * One row per person × project for issues "active" in the window: the issue
 * existed by the end of the window and was last touched on/after its start
 * (a Jira update moves jira_updated_at on any change, so dormant backlog
 * items from before the window are excluded). A person is counted on an
 * issue as the primary assignee or as an additional assignee.
 */
export async function fetchPeopleProjects(
  start: string,
  end: string
): Promise<PersonProjectsRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues");
  cacheTag("projects");
  cacheTag(KEKA_DIRECTORY_TAG);

  const res = await db.execute(sql`
    WITH windowed AS (
      SELECT
        ji.id,
        ji.project_id,
        ji.assignee_email,
        ji.assignee_name,
        ji.additional_assignee_emails,
        ji.completed_at,
        psm.canonical_status
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id AND jp.is_active = true
      LEFT JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
      WHERE ji.jira_created_at::date <= ${end}::date
        AND COALESCE(ji.jira_updated_at, ji.jira_created_at)::date >= ${start}::date
    ),
    person_issue AS (
      SELECT
        id,
        project_id,
        lower(assignee_email) AS email,
        assignee_name AS name,
        completed_at,
        canonical_status
      FROM windowed
      WHERE assignee_email IS NOT NULL AND trim(assignee_email) != ''
      UNION
      SELECT
        w.id,
        w.project_id,
        lower(ae.email) AS email,
        NULL AS name,
        w.completed_at,
        w.canonical_status
      FROM windowed w, unnest(w.additional_assignee_emails) AS ae(email)
      WHERE trim(ae.email) != ''
    )
    SELECT
      pi.email,
      MAX(pi.name) AS name,
      pi.project_id::text AS project_id,
      jp.name AS project_name,
      jp.jira_project_key AS project_key,
      COUNT(DISTINCT pi.id)::int AS issue_count,
      COUNT(DISTINCT pi.id) FILTER (
        WHERE pi.canonical_status IS DISTINCT FROM 'DONE'
          AND pi.canonical_status IS DISTINCT FROM 'CANCELLED'
      )::int AS open_count,
      COUNT(DISTINCT pi.id) FILTER (
        WHERE pi.completed_at::date >= ${start}::date
          AND pi.completed_at::date <= ${end}::date
      )::int AS completed_in_window
    FROM person_issue pi
    JOIN jira_projects jp ON jp.id = pi.project_id
    GROUP BY pi.email, pi.project_id, jp.name, jp.jira_project_key
    ORDER BY pi.email, issue_count DESC
  `);

  const pairs = res.rows as PairRow[];
  const dir = await loadKekaDirectory();

  const byEmail = new Map<string, PersonProjectsRow>();
  for (const pair of pairs) {
    let row = byEmail.get(pair.email);
    if (!row) {
      const e = dir.get(pair.email);
      row = {
        email: pair.email,
        name: e?.displayName ?? pair.name ?? pair.email.split("@")[0],
        department: e?.department ?? null,
        jobTitle: e?.jobTitle ?? null,
        managerName: e?.managerName ?? null,
        projects: [],
        totalIssues: 0,
        totalOpen: 0,
      };
      byEmail.set(pair.email, row);
    }
    // Primary-assignee rows carry a name; keep the first non-null one when
    // Keka doesn't know this person.
    if (!dir.get(pair.email)?.displayName && pair.name && row.name === pair.email.split("@")[0]) {
      row.name = pair.name;
    }
    row.projects.push({
      projectId: pair.project_id,
      projectName: pair.project_name,
      projectKey: pair.project_key,
      issueCount: pair.issue_count,
      openCount: pair.open_count,
      completedInWindow: pair.completed_in_window,
    });
    row.totalIssues += pair.issue_count;
    row.totalOpen += pair.open_count;
  }

  return [...byEmail.values()].sort(
    (a, b) =>
      b.projects.length - a.projects.length ||
      b.totalIssues - a.totalIssues ||
      a.name.localeCompare(b.name)
  );
}

