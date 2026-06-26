import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubAccounts, githubContributorStats, githubRepos } from "@/lib/db/schema";
import { GitHubClient, type ContributorStatsRaw } from "./client";

/** A login is a bot when GitHub types it as one or it uses the [bot] suffix. */
function isBotAccount(login: string, type: string): boolean {
  return type === "Bot" || /\[bot\]$/i.test(login);
}

/**
 * Ensure a github_accounts row exists for each login we see in stats. Identity
 * resolution (login → app user) happens separately in identity.ts; here we just
 * register the account and keep its display fields fresh. Never overwrites
 * user_id / resolved_via — those are owned by the resolver and the superuser.
 */
async function ensureAccounts(stats: ContributorStatsRaw[]): Promise<void> {
  const rows = stats
    .map((s) => s.author)
    .filter((a): a is NonNullable<ContributorStatsRaw["author"]> => a !== null)
    .map((a) => ({
      githubLogin: a.login,
      githubUserId: a.id,
      avatarUrl: a.avatar_url,
      isBot: isBotAccount(a.login, a.type),
      updatedAt: new Date(),
    }));

  if (rows.length === 0) return;

  await db
    .insert(githubAccounts)
    .values(rows)
    .onConflictDoUpdate({
      target: githubAccounts.githubLogin,
      set: {
        githubUserId: sql`excluded.github_user_id`,
        avatarUrl: sql`excluded.avatar_url`,
        // Sticky: auto-detection can promote an account to bot, but never
        // un-flags one a superuser marked (e.g. the co-author "claude"), so the
        // flag survives every resync instead of resetting to the heuristic.
        isBot: sql`${githubAccounts.isBot} OR excluded.is_bot`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

// 'api' = stored from contributor-stats; 'git' = handed off to the git
// collector (degenerate large repo); 'skipped' = already owned by git.
export type SyncRepoStatsResult = { rowsUpserted: number; mode: "api" | "git" | "skipped" };

/**
 * Pull per-author weekly LOC stats for one repo and upsert them into
 * github_contributor_stats. Only weeks with activity are stored (the API
 * returns a zero-filled week for every week since repo creation, which we don't
 * need). GitHub recomputes the full history each call, so the upsert overwrites
 * additions/deletions/commits outright — no out-of-order guard needed.
 *
 * Two large-repo guards:
 *  - A repo already stats_mode='git' is owned by the git collector; we don't
 *    touch it here (so the serverless cron can't clobber git data with zeros).
 *  - If GitHub returns commits but no line data for ANY contributor (its
 *    >~10k-commit limitation), we clear the misleading zero rows and flip the
 *    repo to 'git' so the collector takes over. Returns mode so the CLI can run
 *    the collector inline.
 */
export async function syncRepoStats(
  repoId: string,
  repoFullName: string,
  client?: GitHubClient
): Promise<SyncRepoStatsResult> {
  const [repoRow] = await db
    .select({ statsMode: githubRepos.statsMode })
    .from(githubRepos)
    .where(eq(githubRepos.id, repoId))
    .limit(1);
  if (repoRow?.statsMode === "git") return { rowsUpserted: 0, mode: "skipped" };

  const gh = client ?? new GitHubClient();
  const stats = await gh.getContributorStats(repoFullName);

  // Detect GitHub's large-repo degeneracy: commits present, but no line data.
  const hasCommits = stats.some((s) => s.weeks.some((w) => w.c > 0));
  const hasLineData = stats.some((s) => s.weeks.some((w) => w.a > 0 || w.d > 0));
  if (hasCommits && !hasLineData) {
    await db.delete(githubContributorStats).where(eq(githubContributorStats.repoId, repoId));
    await db
      .update(githubRepos)
      .set({ statsMode: "git", statsSyncedAt: new Date() })
      .where(eq(githubRepos.id, repoId));
    return { rowsUpserted: 0, mode: "git" };
  }

  await ensureAccounts(stats);

  const values: {
    repoId: string;
    githubLogin: string;
    weekStart: Date;
    additions: number;
    deletions: number;
    commits: number;
    syncedAt: Date;
  }[] = [];

  const now = new Date();
  for (const s of stats) {
    if (!s.author) continue;
    for (const wk of s.weeks) {
      if (wk.a === 0 && wk.d === 0 && wk.c === 0) continue;
      values.push({
        repoId,
        githubLogin: s.author.login,
        weekStart: new Date(wk.w * 1000), // GitHub week start is unix seconds, UTC
        additions: wk.a,
        deletions: wk.d,
        commits: wk.c,
        syncedAt: now,
      });
    }
  }

  for (let i = 0; i < values.length; i += 500) {
    await db
      .insert(githubContributorStats)
      .values(values.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [
          githubContributorStats.repoId,
          githubContributorStats.githubLogin,
          githubContributorStats.weekStart,
        ],
        set: {
          additions: sql`excluded.additions`,
          deletions: sql`excluded.deletions`,
          commits: sql`excluded.commits`,
          syncedAt: sql`excluded.synced_at`,
        },
      });
  }

  await db
    .update(githubRepos)
    .set({ statsSyncedAt: now, statsMode: "api" })
    .where(eq(githubRepos.id, repoId));

  return { rowsUpserted: values.length, mode: "api" };
}
