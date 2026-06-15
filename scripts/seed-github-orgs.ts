/**
 * One-time migration helper for the move to multi-org: seed the legacy org
 * (GITHUB_ORG, default salescode-ai) into github_orgs using the GITHUB_TOKEN
 * env PAT (encrypted), then backfill org_id on existing github_repos rows whose
 * full_name belongs to that org. Idempotent — safe to re-run.
 *
 * After this, manage further orgs at /superuser/github-orgs.
 *
 * Run: ./node_modules/.bin/tsx --env-file=.env.local scripts/seed-github-orgs.ts
 */

import { eq, isNull, and, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { githubOrgs, githubRepos } from "../src/lib/db/schema";
import { encrypt } from "../src/lib/crypto";

async function main() {
  const login = process.env.GITHUB_ORG ?? "salescode-ai";
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not set — cannot seed the legacy org");

  const [existing] = await db
    .select({ id: githubOrgs.id })
    .from(githubOrgs)
    .where(eq(githubOrgs.login, login))
    .limit(1);

  let orgId: string;
  if (existing) {
    orgId = existing.id;
    // Refresh the token in case it rotated.
    await db
      .update(githubOrgs)
      .set({ apiToken: encrypt(token), isActive: true, updatedAt: new Date() })
      .where(eq(githubOrgs.id, orgId));
    console.log(`Org "${login}" already present (${orgId}) — token refreshed`);
  } else {
    const [row] = await db
      .insert(githubOrgs)
      .values({ login, apiToken: encrypt(token), isActive: true })
      .returning({ id: githubOrgs.id });
    orgId = row.id;
    console.log(`Seeded org "${login}" (${orgId})`);
  }

  // Backfill org_id on existing repos that belong to this org (full_name
  // prefix) and don't have an org yet.
  const res = await db
    .update(githubRepos)
    .set({ orgId })
    .where(
      and(
        isNull(githubRepos.orgId),
        sql`${githubRepos.fullName} LIKE ${login + "/%"}`
      )
    );
  const rows = (res as unknown as { rowCount?: number }).rowCount ?? 0;
  console.log(`Backfilled org_id on ${rows} existing repos`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
