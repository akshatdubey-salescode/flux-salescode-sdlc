import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubOrgs } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { GitHubClient } from "./client";

export type ActiveOrg = { id: string; login: string; token: string };

/** Active orgs with their PATs decrypted, ready to drive a client. */
export async function loadActiveOrgs(): Promise<ActiveOrg[]> {
  const rows = await db
    .select({
      id: githubOrgs.id,
      login: githubOrgs.login,
      apiToken: githubOrgs.apiToken,
    })
    .from(githubOrgs)
    .where(eq(githubOrgs.isActive, true));

  return rows.map((r) => ({ id: r.id, login: r.login, token: decrypt(r.apiToken) }));
}

export type OrgClient = { login: string; client: GitHubClient };

/**
 * A GitHubClient per active org, keyed by org id, so each repo's stats/commits
 * are fetched with the token that can actually read it (fine-grained PATs are
 * single-org). Used by the stats and identity passes to pick the right client
 * for a repo via its org_id.
 */
export async function buildOrgClients(): Promise<Map<string, OrgClient>> {
  const orgs = await loadActiveOrgs();
  const map = new Map<string, OrgClient>();
  for (const o of orgs) {
    map.set(o.id, {
      login: o.login,
      client: new GitHubClient({ token: o.token, org: o.login }),
    });
  }
  return map;
}
