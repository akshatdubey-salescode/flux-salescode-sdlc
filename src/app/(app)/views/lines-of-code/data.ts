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
  // From the Keka HR directory (joined by app-user id). null when the person
  // isn't mapped to a Keka employee, or the field isn't set.
  department: string | null;
  managerName: string | null;
  // Reporting line from the direct manager up to the top, resolved by walking
  // Keka's reportsTo chain. [0] is the direct manager (== managerName); the rest
  // are each successive manager above. Empty when there's no manager.
  managerChain: string[];
};

export type UnattributedSummary = {
  net: number;
  additions: number;
  deletions: number;
  commits: number;
  accounts: number;
};

// Raw shape returned by the LOC query before the manager chain is resolved.
type LocSqlRow = Omit<LocRow, "managerChain"> & { managerKekaId: string | null };

/**
 * Walk Keka's reportsTo chain from a person's direct manager up to the top,
 * returning [directManager, theirManager, …]. `graph` maps a Keka employee id
 * to that employee's own manager (id + name). Guards against self-reports and
 * cycles (Keka's top person reports to themselves) via a visited set.
 */
function buildManagerChain(
  directName: string | null,
  directManagerId: string | null,
  graph: Map<string, { managerId: string | null; managerName: string | null }>
): string[] {
  if (!directName) return [];
  const chain = [directName];
  if (!directManagerId) return chain;

  const visited = new Set<string>([directManagerId]);
  let curId: string | null = directManagerId;
  for (let depth = 0; curId && depth < 15; depth++) {
    const node = graph.get(curId);
    if (!node?.managerId || !node.managerName) break;
    if (visited.has(node.managerId)) break; // self-report / cycle → stop
    chain.push(node.managerName);
    visited.add(node.managerId);
    curId = node.managerId;
  }
  return chain;
}

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
    ),
    -- Pre-aggregate Keka to one row per user so the join can't multiply the
    -- per-person stats (and is robust if a user ever maps to >1 Keka row).
    -- Keka holds only ACTIVE employees (the sync prunes anyone relieved), so an
    -- inner join below restricts the board to people currently at the company.
    keka AS (
      SELECT user_id,
             MAX(department) AS department,
             MAX(manager_name) AS manager_name,
             MAX(manager_keka_id) AS manager_keka_id
      FROM keka_employees
      WHERE user_id IS NOT NULL
      GROUP BY user_id
    )
    SELECT
      ROW_NUMBER() OVER (ORDER BY ps.net DESC, ps.commits DESC)::int AS rank,
      ps.email, ps.name, ps.net, ps.additions, ps.deletions, ps.commits, ps.repos,
      k.department AS department,
      k.manager_name AS "managerName",
      k.manager_keka_id AS "managerKekaId"
    FROM person_stats ps
    -- Inner join: only contributors who are current (active) Keka employees.
    -- Former employees, pruned from keka_employees, drop off the board.
    JOIN keka k ON k.user_id = ps.email
    ORDER BY ps.net DESC, ps.commits DESC
    LIMIT 200
  `);

  // Manager graph: Keka employee id → that employee's own manager (id + name),
  // used to walk each person's reporting line up the tree.
  const graphRes = await db.execute(sql`
    SELECT keka_employee_id AS id,
           manager_keka_id AS "managerId",
           manager_name AS "managerName"
    FROM keka_employees
  `);
  const graph = new Map<string, { managerId: string | null; managerName: string | null }>();
  for (const g of graphRes.rows as {
    id: string;
    managerId: string | null;
    managerName: string | null;
  }[]) {
    graph.set(g.id, { managerId: g.managerId, managerName: g.managerName });
  }

  return (res.rows as LocSqlRow[]).map((r) => ({
    rank: r.rank,
    email: r.email,
    name: r.name,
    net: r.net,
    additions: r.additions,
    deletions: r.deletions,
    commits: r.commits,
    repos: r.repos,
    department: r.department,
    managerName: r.managerName,
    managerChain: buildManagerChain(r.managerName, r.managerKekaId, graph),
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
