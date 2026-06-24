import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubOrgs, githubRepos } from "@/lib/db/schema";
import { GitHubClient, type GitHubRepoRaw } from "./client";
import { loadActiveOrgs } from "./orgs";

export type SyncReposResult = {
  upserted: number;
  pruned: number;
  orgsSynced: number;
  orgErrors: string[];
};

/**
 * Mirror every active org's repositories into github_repos. Each org is synced
 * with its own PAT and pruned independently, so one org's listing failing (bad
 * token, revoked access) never causes another org's repos to be pruned.
 *
 * isTracked is preserved across syncs: a superuser may untrack a noisy repo and
 * a metadata refresh must not silently re-enable it. New repos default to
 * tracked; archived repos are seeded untracked so they don't pollute the
 * dashboard until someone opts them in.
 */
export async function syncRepos(): Promise<SyncReposResult> {
  const orgs = await loadActiveOrgs();
  let upserted = 0;
  let pruned = 0;
  let orgsSynced = 0;
  const orgErrors: string[] = [];

  for (const org of orgs) {
    const client = new GitHubClient({ token: org.token, org: org.login });
    const syncStartedAt = new Date();
    const seenIds = new Set<number>();

    try {
      const repos = await client.listOrgRepos();
      for (const r of repos) {
        seenIds.add(r.id);
        await upsertRepo(r, org.id);
        upserted++;
      }
      pruned += await pruneReposForOrg(org.id, seenIds, syncStartedAt);
      await db
        .update(githubOrgs)
        .set({ lastSyncedAt: new Date() })
        .where(eq(githubOrgs.id, org.id));
      orgsSynced++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      orgErrors.push(`${org.login}: ${msg}`);
    }
  }

  return { upserted, pruned, orgsSynced, orgErrors };
}

async function upsertRepo(r: GitHubRepoRaw, orgId: string): Promise<void> {
  const values = {
    orgId,
    githubRepoId: r.id,
    name: r.name,
    fullName: r.full_name,
    defaultBranch: r.default_branch,
    isPrivate: r.private,
    language: r.language,
    // Seed archived repos as untracked; everything else tracked by default.
    isTracked: !r.archived,
    pushedAt: r.pushed_at ? new Date(r.pushed_at) : null,
    updatedAt: new Date(),
  };

  await db
    .insert(githubRepos)
    .values(values)
    .onConflictDoUpdate({
      target: githubRepos.githubRepoId,
      // Refresh metadata + org binding only — never touch isTracked or
      // statsSyncedAt here, so a superuser's tracking choice and the stats
      // cursor survive re-syncs. orgId is refreshed so a transferred repo
      // re-binds to its new org.
      set: {
        orgId: values.orgId,
        name: values.name,
        fullName: values.fullName,
        defaultBranch: values.defaultBranch,
        isPrivate: values.isPrivate,
        language: values.language,
        pushedAt: values.pushedAt,
        updatedAt: values.updatedAt,
      },
    });
}

/**
 * Delete github_repos rows for one org that the org's API no longer returns.
 * Guards mirror the Jira prune: only rows untouched by this sync are
 * candidates, and an empty API response against a non-empty mirror is treated
 * as suspicious (revoked token) and skipped rather than wiping the org.
 */
async function pruneReposForOrg(
  orgId: string,
  seenIds: Set<number>,
  syncStartedAt: Date
): Promise<number> {
  const candidates = await db
    .select({ id: githubRepos.id, githubRepoId: githubRepos.githubRepoId })
    .from(githubRepos)
    .where(and(eq(githubRepos.orgId, orgId), lt(githubRepos.updatedAt, syncStartedAt)));

  if (candidates.length === 0) return 0;

  if (seenIds.size === 0) {
    console.warn(
      `[github] repo prune skipped for org ${orgId}: API returned 0 repos but ${candidates.length} rows exist locally — refusing to wipe`
    );
    return 0;
  }

  const stale = candidates.filter((c) => !seenIds.has(c.githubRepoId));
  if (stale.length === 0) return 0;

  for (let i = 0; i < stale.length; i += 500) {
    await db.delete(githubRepos).where(
      inArray(
        githubRepos.id,
        stale.slice(i, i + 500).map((r) => r.id)
      )
    );
  }
  console.log(`[github] pruned ${stale.length} repo(s) no longer in org ${orgId}`);
  return stale.length;
}

/** Tracked repos with their org binding — stats pull picks the org's client.
 * defaultBranch/extraBranches feed the git collector for repos a superuser has
 * pointed at extra branches; the API stats path ignores them. */
export async function getTrackedRepos(): Promise<
  {
    id: string;
    fullName: string;
    orgId: string | null;
    defaultBranch: string | null;
    extraBranches: string[];
  }[]
> {
  return db
    .select({
      id: githubRepos.id,
      fullName: githubRepos.fullName,
      orgId: githubRepos.orgId,
      defaultBranch: githubRepos.defaultBranch,
      extraBranches: githubRepos.extraBranches,
    })
    .from(githubRepos)
    .where(eq(githubRepos.isTracked, true))
    .orderBy(sql`${githubRepos.pushedAt} DESC NULLS LAST`);
}
