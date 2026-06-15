import { cacheLife, cacheTag } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { GITHUB_STATS_TAG } from "@/lib/github/cache-tags";

export type LocRow = {
  rank: number;
  email: string;
  name: string;
  net: number;
  additions: number;
  deletions: number;
  commits: number;
  repos: number;
};

export type UnattributedSummary = {
  net: number;
  additions: number;
  deletions: number;
  commits: number;
  accounts: number;
};

type LocAggRow = Omit<LocRow, "rank">;

/**
 * Per-person net lines of code (additions − deletions) over a date window,
 * summed across every GitHub login mapped to the person and across tracked
 * repos. Weekly buckets are filtered by week-start date — the metric is
 * weekly-granular by nature of GitHub's contributor-stats source. Bots and
 * unmapped logins are excluded here (the latter are surfaced separately).
 */
export async function fetchLinesOfCode(
  start: string,
  end: string
): Promise<LocRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(GITHUB_STATS_TAG);

  const res = await db.execute(sql`
    WITH person_stats AS (
      SELECT
        u.id AS email,
        COALESCE(MAX(ga.display_name), u.email) AS name,
        SUM(gcs.additions)::int AS additions,
        SUM(gcs.deletions)::int AS deletions,
        SUM(gcs.additions - gcs.deletions)::int AS net,
        SUM(gcs.commits)::int AS commits,
        COUNT(DISTINCT gcs.repo_id)::int AS repos
      FROM github_contributor_stats gcs
      JOIN github_repos gr ON gr.id = gcs.repo_id AND gr.is_tracked = true
      JOIN github_accounts ga ON ga.github_login = gcs.github_login
      JOIN users u ON u.id = ga.user_id
      WHERE ga.is_bot = false
        AND gcs.week_start::date >= ${start}::date
        AND gcs.week_start::date <= ${end}::date
      GROUP BY u.id
    )
    SELECT
      ROW_NUMBER() OVER (ORDER BY net DESC, commits DESC)::int AS rank,
      email, name, net, additions, deletions, commits, repos
    FROM person_stats
    ORDER BY net DESC, commits DESC
    LIMIT 200
  `);

  return (res.rows as (LocAggRow & { rank: number })[]).map((r) => ({
    rank: r.rank,
    email: r.email,
    name: r.name,
    net: r.net,
    additions: r.additions,
    deletions: r.deletions,
    commits: r.commits,
    repos: r.repos,
  }));
}

/**
 * Totals for non-bot GitHub logins that aren't yet mapped to a person, in the
 * same window. Shown as a footnote so the dashboard is honest about coverage —
 * these contributions exist but can't be attributed until someone maps the
 * account at /superuser/github-accounts.
 */
export async function fetchUnattributed(
  start: string,
  end: string
): Promise<UnattributedSummary> {
  "use cache";
  cacheLife("minutes");
  cacheTag(GITHUB_STATS_TAG);

  const res = await db.execute(sql`
    SELECT
      COALESCE(SUM(gcs.additions - gcs.deletions), 0)::int AS net,
      COALESCE(SUM(gcs.additions), 0)::int AS additions,
      COALESCE(SUM(gcs.deletions), 0)::int AS deletions,
      COALESCE(SUM(gcs.commits), 0)::int AS commits,
      COUNT(DISTINCT gcs.github_login)::int AS accounts
    FROM github_contributor_stats gcs
    JOIN github_repos gr ON gr.id = gcs.repo_id AND gr.is_tracked = true
    JOIN github_accounts ga ON ga.github_login = gcs.github_login
    WHERE ga.is_bot = false
      AND ga.user_id IS NULL
      AND gcs.week_start::date >= ${start}::date
      AND gcs.week_start::date <= ${end}::date
  `);

  return (res.rows as UnattributedSummary[])[0];
}

export type RepoBreakdownRow = {
  repo: string;
  org: string;
  net: number;
  additions: number;
  deletions: number;
  commits: number;
};

export type PersonBreakdown = {
  email: string;
  logins: string[];
  repos: RepoBreakdownRow[];
  totals: { net: number; additions: number; deletions: number; commits: number };
};

/**
 * Drill-down for one person: their net LOC split per repo over the window,
 * summed across every GitHub login mapped to them and across all orgs. The org
 * is shown so the same repo name in different orgs is unambiguous.
 */
export async function fetchPersonBreakdown(
  email: string,
  start: string,
  end: string
): Promise<PersonBreakdown> {
  "use cache";
  cacheLife("minutes");
  cacheTag(GITHUB_STATS_TAG);

  const res = await db.execute(sql`
    SELECT
      gr.full_name AS repo,
      split_part(gr.full_name, '/', 1) AS org,
      SUM(gcs.additions)::int AS additions,
      SUM(gcs.deletions)::int AS deletions,
      SUM(gcs.additions - gcs.deletions)::int AS net,
      SUM(gcs.commits)::int AS commits
    FROM github_contributor_stats gcs
    JOIN github_repos gr ON gr.id = gcs.repo_id AND gr.is_tracked = true
    JOIN github_accounts ga ON ga.github_login = gcs.github_login
    WHERE ga.user_id = ${email} AND ga.is_bot = false
      AND gcs.week_start::date >= ${start}::date
      AND gcs.week_start::date <= ${end}::date
    GROUP BY gr.full_name
    HAVING SUM(gcs.commits) > 0 OR SUM(gcs.additions - gcs.deletions) <> 0
    ORDER BY net DESC
  `);
  const repos = res.rows as RepoBreakdownRow[];

  const loginsRes = await db.execute(sql`
    SELECT github_login FROM github_accounts
    WHERE user_id = ${email} AND is_bot = false
    ORDER BY github_login
  `);
  const logins = (loginsRes.rows as { github_login: string }[]).map((r) => r.github_login);

  const totals = repos.reduce(
    (acc, r) => ({
      net: acc.net + r.net,
      additions: acc.additions + r.additions,
      deletions: acc.deletions + r.deletions,
      commits: acc.commits + r.commits,
    }),
    { net: 0, additions: 0, deletions: 0, commits: 0 }
  );

  return { email, logins, repos, totals };
}
