/**
 * Compute line stats from git history for repos GitHub won't (those past its
 * ~10k-commit contributor-graph limit). Finds candidates from our own data
 * (stats_mode='git', or stored commits with zero lines), clones each, runs
 * `git log --numstat`, and replaces that repo's rows in github_contributor_stats.
 * No per-commit API calls. Requires `git` on PATH.
 *
 * Run this where git is available (the serverless cron can't clone). Safe to
 * re-run; it fully replaces each affected repo's stats.
 *
 * Run: ./node_modules/.bin/tsx --env-file=.env.local scripts/collect-git-stats.ts
 */

import { loadActiveOrgs } from "../src/lib/github/orgs";
import {
  findReposNeedingGitStats,
  collectGitStatsForRepo,
} from "../src/lib/github/git-stats";

async function main() {
  const orgs = await loadActiveOrgs();
  const tokenByOrg = new Map(orgs.map((o) => [o.id, o.token]));

  const repos = await findReposNeedingGitStats();
  if (repos.length === 0) {
    console.log("No repos need git-based line stats.");
    return;
  }
  console.log(`${repos.length} repo(s) need git-based line stats:\n`);

  let ok = 0;
  let failed = 0;
  for (const [i, repo] of repos.entries()) {
    const token = repo.orgId ? tokenByOrg.get(repo.orgId) : undefined;
    process.stdout.write(`  [${i + 1}/${repos.length}] ${repo.fullName} … `);
    if (!token) {
      failed++;
      console.log("✗ no active org/token");
      continue;
    }
    try {
      const g = await collectGitStatsForRepo(repo, token);
      ok++;
      console.log(
        `${g.rowsUpserted} rows (${g.attributedCommits} attributed / ${g.unattributedCommits} unattributed commits)`
      );
    } catch (err) {
      failed++;
      console.log(`✗ ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\nDone: ${ok} collected, ${failed} failed.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
