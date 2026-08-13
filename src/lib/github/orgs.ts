import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubOrgs } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { GitHubClient } from "./client";
import { getInstallationToken } from "./app-auth";

export type ActiveOrg = {
  id: string;
  login: string;
  token: string;
  // 'auto' = discover repos by listing the org; 'manual' = only the repos a
  // superuser registered by full name (partial-access PAT). See schema.
  discoveryMode: string;
};

/**
 * Active orgs with a ready-to-use token — a decrypted PAT for authMode='pat'
 * orgs, or a freshly-minted (cached) GitHub App installation token for
 * authMode='app' orgs. Either way the caller gets back a plain bearer token
 * and doesn't need to know which kind it is; GitHubClient never changes.
 */
export async function loadActiveOrgs(): Promise<ActiveOrg[]> {
  const rows = await db
    .select({
      id: githubOrgs.id,
      login: githubOrgs.login,
      authMode: githubOrgs.authMode,
      apiToken: githubOrgs.apiToken,
      appInstallationId: githubOrgs.appInstallationId,
      discoveryMode: githubOrgs.discoveryMode,
    })
    .from(githubOrgs)
    .where(eq(githubOrgs.isActive, true));

  const out: ActiveOrg[] = [];
  for (const r of rows) {
    const token =
      r.authMode === "app" && r.appInstallationId
        ? await getInstallationToken(r.appInstallationId)
        : decrypt(r.apiToken ?? "");
    out.push({ id: r.id, login: r.login, token, discoveryMode: r.discoveryMode });
  }
  return out;
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
