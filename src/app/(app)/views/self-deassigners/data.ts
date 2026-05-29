import { cacheLife, cacheTag } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export type TeamRef = { id: string; name: string };

export type SelfDeassignerRow = {
  rank: number;
  account_id: string;
  email: string | null;
  name: string;
  total: number;
  to_unassigned: number;
  to_reporter: number;
  to_other: number;
  teams: TeamRef[];
};

type RankRow = {
  rank: number;
  account_id: string;
  email: string | null;
  name: string | null;
  total: number;
  to_unassigned: number;
  to_reporter: number;
  to_other: number;
};

type TeamRow = { email: string; id: string; name: string };

/**
 * Ranks people by how often they removed *themselves* as the assignee of an
 * issue within the given window (changelog author === previous assignee).
 * Broken down by where the work went: unassigned, back to the reporter, or to
 * someone else. Automation/app authors are excluded at parse time.
 *
 * This is a candidate list, not a verdict — legitimate handoffs also show up.
 */
export type SelfDeassignerSort = "total" | "unassigned" | "reporter" | "other";
export type SortDir = "asc" | "desc";

export async function fetchTopSelfDeassigners(
  start: string,
  end: string,
  sort: SelfDeassignerSort = "total",
  dir: SortDir = "desc"
): Promise<SelfDeassignerRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues");
  cacheTag("boards");

  const sortCol =
    sort === "unassigned"
      ? sql`to_unassigned`
      : sort === "reporter"
        ? sql`to_reporter`
        : sort === "other"
          ? sql`to_other`
          : sql`total`;
  const dirExpr = dir === "asc" ? sql`ASC` : sql`DESC`;
  // account_id keeps ties deterministic regardless of sort direction.
  const orderExpr = sql`${sortCol} ${dirExpr}, account_id ASC`;

  const ranked = await db.execute(sql`
    WITH self_removals AS (
      SELECT
        jac.author_account_id AS account_id,
        jac.author_email AS email,
        jac.author_name AS name,
        jac.to_kind
      FROM jira_assignee_changes jac
      WHERE jac.is_self_removal = true
        AND jac.author_account_id IS NOT NULL
        AND jac.changed_at::date >= ${start}::date
        AND jac.changed_at::date <= ${end}::date
    ),
    ranked AS (
      SELECT
        account_id,
        MAX(email) AS email,
        MAX(name) AS name,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE to_kind = 'unassigned')::int AS to_unassigned,
        COUNT(*) FILTER (WHERE to_kind = 'reporter')::int AS to_reporter,
        COUNT(*) FILTER (WHERE to_kind = 'other')::int AS to_other
      FROM self_removals
      GROUP BY account_id
    )
    SELECT
      ROW_NUMBER() OVER (ORDER BY ${orderExpr})::int AS rank,
      account_id,
      email,
      COALESCE(name, '(unknown)') AS name,
      total,
      to_unassigned,
      to_reporter,
      to_other
    FROM ranked
    ORDER BY ${orderExpr}
    LIMIT 25
  `);

  const topRows = ranked.rows as RankRow[];
  if (topRows.length === 0) return [];

  const emails = topRows
    .map((r) => r.email?.toLowerCase())
    .filter((e): e is string => !!e);

  const teamsByEmail = new Map<string, TeamRef[]>();
  if (emails.length > 0) {
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
    for (const row of boards.rows as TeamRow[]) {
      const list = teamsByEmail.get(row.email) ?? [];
      list.push({ id: row.id, name: row.name });
      teamsByEmail.set(row.email, list);
    }
  }

  return topRows.map((r) => ({
    ...r,
    name: r.name ?? "(unknown)",
    teams: r.email ? teamsByEmail.get(r.email.toLowerCase()) ?? [] : [],
  }));
}

export type SelfRemovalEvent = {
  jira_key: string;
  summary: string;
  browse_url: string;
  from_name: string | null;
  to_name: string | null;
  to_kind: string;
  changed_at: string;
};

export type SelfRemovalDetail = {
  name: string;
  email: string | null;
  events: SelfRemovalEvent[];
};

/**
 * Drill-down: every issue a given person removed themselves from in the window,
 * most recent first. Keyed on the changelog author's accountId.
 */
export async function fetchSelfRemovalEvents(
  accountId: string,
  start: string,
  end: string
): Promise<SelfRemovalDetail> {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues");

  const res = await db.execute(sql`
    SELECT
      ji.jira_key,
      ji.summary,
      -- Build the real Jira issue URL: https://org.atlassian.net/browse/KEY
      rtrim(jp.jira_base_url, '/') || '/browse/' || ji.jira_key AS browse_url,
      jac.author_name,
      jac.author_email,
      jac.from_name,
      jac.to_name,
      jac.to_kind,
      jac.changed_at
    FROM jira_assignee_changes jac
    JOIN jira_issues ji ON ji.id = jac.issue_id
    JOIN jira_projects jp ON jp.id = ji.project_id
    WHERE jac.is_self_removal = true
      AND jac.author_account_id = ${accountId}
      AND jac.changed_at::date >= ${start}::date
      AND jac.changed_at::date <= ${end}::date
    ORDER BY jac.changed_at DESC
    LIMIT 200
  `);

  const rows = res.rows as Array<
    SelfRemovalEvent & { author_name: string | null; author_email: string | null }
  >;

  return {
    name: rows[0]?.author_name ?? "(unknown)",
    email: rows[0]?.author_email ?? null,
    events: rows.map((r) => ({
      jira_key: r.jira_key,
      summary: r.summary,
      browse_url: r.browse_url,
      from_name: r.from_name,
      to_name: r.to_name,
      to_kind: r.to_kind,
      changed_at: r.changed_at,
    })),
  };
}
