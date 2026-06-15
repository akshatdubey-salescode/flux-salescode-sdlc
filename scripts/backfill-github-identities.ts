/**
 * Re-run GitHub identity resolution: match any still-unmapped, non-bot
 * github_accounts to app users by commit-author / profile email. Useful after
 * new users sign up (so their past commits get attributed) without a full
 * contributor-stats re-sync. Accounts that stay unmapped here are mapped by a
 * superuser at /superuser/github-accounts.
 *
 * Requires github_accounts to be populated already (run sync:github first).
 *
 * Run: ./node_modules/.bin/tsx --env-file=.env.local scripts/backfill-github-identities.ts
 */

import {
  resolveGithubIdentities,
  countUnmappedAccounts,
} from "../src/lib/github/identity";

async function main() {
  const before = await countUnmappedAccounts();
  console.log(`Unmapped (non-bot) accounts before: ${before}`);

  const { resolved } = await resolveGithubIdentities();

  const after = await countUnmappedAccounts();
  console.log(`Resolved ${resolved} account(s) by email`);
  console.log(`Unmapped (non-bot) accounts remaining: ${after}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
