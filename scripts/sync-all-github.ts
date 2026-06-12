/**
 * Full GitHub sync across every active org in github_orgs, run directly against
 * the DB (no API/auth round-trip). Mirrors each org's repos into github_repos
 * with its own PAT, pulls contributor stats for every tracked repo, then
 * resolves GitHub logins to app users. Idempotent — safe to re-run; the daily
 * cron does the same work.
 *
 * Add orgs first at /superuser/github-orgs (or run `pnpm seed:github-orgs` to
 * seed the legacy org from GITHUB_TOKEN/GITHUB_ORG).
 *
 * Run: ./node_modules/.bin/tsx --env-file=.env.local scripts/sync-all-github.ts
 */

import { loadActiveOrgs, buildOrgClients } from "../src/lib/github/orgs";
import { syncRepos, getTrackedRepos } from "../src/lib/github/repos";
import { syncRepoStats } from "../src/lib/github/stats-sync";
import { collectGitStatsForRepo } from "../src/lib/github/git-stats";
import {
  resolveGithubIdentities,
  countUnmappedAccounts,
} from "../src/lib/github/identity";

async function main() {
  const orgs = await loadActiveOrgs();
  if (orgs.length === 0) {
    throw new Error(
      "No active orgs in github_orgs. Add one at /superuser/github-orgs or run `pnpm seed:github-orgs`."
    );
  }
  console.log(`Active orgs: ${orgs.map((o) => o.login).join(", ")}`);

  console.log(`\n== Step 1/3: syncing repos ==`);
  const { upserted, pruned, orgsSynced, orgErrors } = await syncRepos();
  console.log(`  ${orgsSynced}/${orgs.length} orgs ok, ${upserted} repos upserted, ${pruned} pruned`);
  for (const e of orgErrors) console.log(`  ✗ ${e}`);

  const tokenByOrg = new Map(orgs.map((o) => [o.id, o.token]));
  const orgClients = await buildOrgClients();
  const repos = await getTrackedRepos();
  console.log(`\n== Step 2/3: pulling contributor stats for ${repos.length} tracked repos ==`);

  let totalRows = 0;
  let failed = 0;
  let gitRepos = 0;
  for (const [i, repo] of repos.entries()) {
    const oc = repo.orgId ? orgClients.get(repo.orgId) : undefined;
    const token = repo.orgId ? tokenByOrg.get(repo.orgId) : undefined;
    process.stdout.write(`  [${i + 1}/${repos.length}] ${repo.fullName} … `);
    if (!oc || !token) {
      failed++;
      console.log("✗ no active org/token");
      continue;
    }
    try {
      const { rowsUpserted, mode } = await syncRepoStats(repo.id, repo.fullName, oc.client);
      // Large repo: GitHub has no line data → compute locally with git log.
      if (mode === "git" || mode === "skipped") {
        const g = await collectGitStatsForRepo(repo, token);
        totalRows += g.rowsUpserted;
        gitRepos++;
        console.log(
          `git: ${g.rowsUpserted} rows (${g.attributedCommits} attributed / ${g.unattributedCommits} unattributed commits)`
        );
      } else {
        totalRows += rowsUpserted;
        console.log(`${rowsUpserted} week-rows`);
      }
    } catch (err) {
      failed++;
      console.log(`✗ ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`  done: ${totalRows} stat rows upserted, ${gitRepos} via git, ${failed} repos failed`);

  console.log(`\n== Step 3/3: resolving GitHub logins to app users ==`);
  const { resolved } = await resolveGithubIdentities();
  const remaining = await countUnmappedAccounts();
  console.log(`  resolved ${resolved} account(s) by email`);
  console.log(
    `\nRemaining unmapped accounts (map them at /superuser/github-accounts): ${remaining}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
