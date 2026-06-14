import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";
import { stampCache, withCacheMetrics } from "@/lib/cache/metrics";
import { GITHUB_STATS_TAG } from "@/lib/github/cache-tags";
import { currentFiscalQuarterChip } from "@/lib/date-utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CommitterStat = {
  /** users.id — the person's email-keyed id. */
  email: string;
  name: string;
  /** Commits across every GitHub login mapped to the person, in the window. */
  commits: number;
  net: number;
  additions: number;
  deletions: number;
  /** Distinct tracked repos contributed to. */
  repos: number;
};

export type CommittersResponse = {
  range: { start: string; end: string };
  committers: CommitterStat[];
};

type AggRow = {
  email: string;
  name: string;
  commits: number;
  net: number;
  additions: number;
  deletions: number;
  repos: number;
};

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    await requireAuth();
    const p = new URL(request.url).searchParams;

    const fq = currentFiscalQuarterChip();
    const start = p.get("start") ?? fq.start;
    const end = p.get("end") ?? fq.end;

    const { data, headers } = await withCacheMetrics("committers", () =>
      fetchTopCommitters({ start, end })
    );
    return NextResponse.json(data, { headers });
  } catch (error) {
    console.error("Committers error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

/**
 * People ranked by GitHub commits over a date window, summed across every login
 * mapped to the person and across tracked repos. Mirrors the lines-of-code query
 * but sorts by commit count. Bots and unmapped logins are excluded; weekly
 * buckets are filtered by week-start date (GitHub's contributor-stats grain).
 */
async function fetchTopCommitters(opts: {
  start: string;
  end: string;
}): Promise<ReturnType<typeof stampCache>> {
  "use cache";
  cacheLife("minutes");
  cacheTag(GITHUB_STATS_TAG);

  const res = await db.execute(sql`
    SELECT
      u.id AS email,
      COALESCE(MAX(ga.display_name), u.email) AS name,
      SUM(gcs.commits)::int AS commits,
      SUM(gcs.additions)::int AS additions,
      SUM(gcs.deletions)::int AS deletions,
      SUM(gcs.additions - gcs.deletions)::int AS net,
      COUNT(DISTINCT gcs.repo_id)::int AS repos
    FROM github_contributor_stats gcs
    JOIN github_repos gr ON gr.id = gcs.repo_id AND gr.is_tracked = true
    JOIN github_accounts ga ON ga.github_login = gcs.github_login
    JOIN users u ON u.id = ga.user_id
    WHERE ga.is_bot = false
      AND gcs.week_start::date >= ${opts.start}::date
      AND gcs.week_start::date <= ${opts.end}::date
    GROUP BY u.id
    HAVING SUM(gcs.commits) > 0
    ORDER BY commits DESC, net DESC
    LIMIT 50
  `);

  const committers = (res.rows as AggRow[]).map((r) => ({
    email: r.email,
    name: r.name,
    commits: r.commits,
    net: r.net,
    additions: r.additions,
    deletions: r.deletions,
    repos: r.repos,
  }));

  const response: CommittersResponse = {
    range: { start: opts.start, end: opts.end },
    committers,
  };
  return stampCache(response);
}
