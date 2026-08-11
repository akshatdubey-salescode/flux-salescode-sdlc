"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { githubOrgs, githubRepos } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { GitHubClient } from "@/lib/github/client";
import { GITHUB_STATS_TAG } from "@/lib/github/cache-tags";

const ORG_PATH = "/superuser/github-orgs";

export type DiscoveryMode = "auto" | "manual";

/**
 * Validates a token against the access check its discovery mode actually
 * supports — 'auto' orgs (e.g. salescode-ai, visible to every employee) can
 * list the whole org, so testOrgAccess (GET /orgs/{org}/repos) is the right
 * check. 'manual' orgs (e.g. salescode-tools, stakeholder-only visibility)
 * never support org-wide listing regardless of token — testOrgAccess would
 * 404/403 there even for a token with full per-repo access, so this only
 * confirms the token authenticates at all; per-repo access is checked
 * separately whenever a repo is registered (addManualRepo).
 * Returns an error string on failure, or null on success.
 */
async function validateTokenForMode(
  client: GitHubClient,
  mode: DiscoveryMode
): Promise<string | null> {
  if (mode === "auto") return client.testOrgAccess();
  return (await client.testConnection()) ? null : "Invalid or expired token.";
}

/**
 * Add (or re-key) a GitHub org. See validateTokenForMode for why the access
 * check differs by discovery mode. Returns an error string on validation
 * failure so the form can surface it.
 */
export async function addGithubOrg(
  login: string,
  token: string,
  discoveryMode: DiscoveryMode = "auto"
): Promise<{ error?: string }> {
  const user = await requireRole("SUPERUSER");

  const cleanLogin = login.trim();
  const cleanToken = token.trim();
  const mode: DiscoveryMode = discoveryMode === "manual" ? "manual" : "auto";
  if (!cleanLogin) return { error: "Org login is required." };
  if (!cleanToken) return { error: "A token is required." };

  const client = new GitHubClient({ token: cleanToken, org: cleanLogin });
  const accessError = await validateTokenForMode(client, mode);
  if (accessError) return { error: accessError };

  await db
    .insert(githubOrgs)
    .values({
      login: cleanLogin,
      apiToken: encrypt(cleanToken),
      discoveryMode: mode,
      isActive: true,
      createdBy: user.id,
    })
    .onConflictDoUpdate({
      target: githubOrgs.login,
      set: {
        apiToken: encrypt(cleanToken),
        discoveryMode: mode,
        isActive: true,
        updatedAt: new Date(),
      },
    });

  revalidateTag(GITHUB_STATS_TAG, "max");
  revalidatePath(ORG_PATH);
  return {};
}

/**
 * Register a single repo (by "owner/repo") under a manual-discovery org and
 * mark it tracked. Verifies this org's PAT can actually read the repo before
 * persisting it; the next sync pulls its stats like any other tracked repo.
 */
export async function addManualRepo(
  orgId: string,
  fullName: string
): Promise<{ error?: string }> {
  await requireRole("SUPERUSER");

  const clean = fullName.trim().replace(/^\/+|\/+$/g, "");
  if (!/^[^/\s]+\/[^/\s]+$/.test(clean)) {
    return { error: 'Use the form "owner/repo" (e.g. acme-co/billing-service).' };
  }

  const [org] = await db
    .select({
      login: githubOrgs.login,
      apiToken: githubOrgs.apiToken,
      discoveryMode: githubOrgs.discoveryMode,
    })
    .from(githubOrgs)
    .where(eq(githubOrgs.id, orgId))
    .limit(1);
  if (!org) return { error: "Org not found." };
  if (org.discoveryMode !== "manual") {
    return { error: "This org auto-discovers its repos; add repos isn't needed here." };
  }

  let repo;
  try {
    repo = await new GitHubClient({
      token: decrypt(org.apiToken),
      org: org.login,
    }).getRepo(clean);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  if (!repo) {
    return { error: `Repo not found, or this org's token can't read "${clean}".` };
  }

  await db
    .insert(githubRepos)
    .values({
      orgId,
      githubRepoId: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      isPrivate: repo.private,
      language: repo.language,
      isTracked: true,
      pushedAt: repo.pushed_at ? new Date(repo.pushed_at) : null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: githubRepos.githubRepoId,
      set: {
        orgId,
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
        isPrivate: repo.private,
        language: repo.language,
        isTracked: true, // re-adding a removed repo re-tracks it
        pushedAt: repo.pushed_at ? new Date(repo.pushed_at) : null,
        updatedAt: new Date(),
      },
    });

  revalidateTag(GITHUB_STATS_TAG, "max");
  revalidatePath(ORG_PATH);
  return {};
}

/**
 * Remove a manually-registered repo (and, via cascade, its contributor stats).
 * Scoped to manual orgs so it can't be used to delete an auto-discovered repo,
 * which the next sync would just re-add anyway.
 */
export async function removeManualRepo(repoId: string): Promise<{ error?: string }> {
  await requireRole("SUPERUSER");

  const [row] = await db
    .select({ mode: githubOrgs.discoveryMode })
    .from(githubRepos)
    .leftJoin(githubOrgs, eq(githubOrgs.id, githubRepos.orgId))
    .where(eq(githubRepos.id, repoId))
    .limit(1);
  if (!row) return { error: "Repo not found." };
  if (row.mode !== "manual") {
    return { error: "Only manually-registered repos can be removed here." };
  }

  await db.delete(githubRepos).where(eq(githubRepos.id, repoId));

  revalidateTag(GITHUB_STATS_TAG, "max");
  revalidatePath(ORG_PATH);
  return {};
}

/**
 * Rotate an existing org's PAT without re-typing its login. Validates the new
 * token against the check its discovery mode actually supports (see
 * validateTokenForMode) before persisting it (encrypted) — previously this
 * always ran the 'auto' org-listing check regardless of mode, which made a
 * manual-mode org's token permanently un-rotatable once the old one died: the
 * new token would fail the org-listing check even with full per-repo access,
 * the exact scenario manual mode exists for. This is the token every repo in
 * the org is fetched/cloned with, so updating it here updates access for all
 * of them. Leaves isActive untouched.
 */
export async function updateGithubOrgToken(
  id: string,
  token: string
): Promise<{ error?: string }> {
  await requireRole("SUPERUSER");

  const cleanToken = token.trim();
  if (!cleanToken) return { error: "A token is required." };

  const [org] = await db
    .select({ login: githubOrgs.login, discoveryMode: githubOrgs.discoveryMode })
    .from(githubOrgs)
    .where(eq(githubOrgs.id, id))
    .limit(1);
  if (!org) return { error: "Org not found." };

  const mode: DiscoveryMode = org.discoveryMode === "manual" ? "manual" : "auto";
  const accessError = await validateTokenForMode(
    new GitHubClient({ token: cleanToken, org: org.login }),
    mode
  );
  if (accessError) return { error: accessError };

  await db
    .update(githubOrgs)
    .set({ apiToken: encrypt(cleanToken), updatedAt: new Date() })
    .where(eq(githubOrgs.id, id));

  revalidateTag(GITHUB_STATS_TAG, "max");
  revalidatePath(ORG_PATH);
  return {};
}

export async function setGithubOrgActive(
  id: string,
  isActive: boolean
): Promise<void> {
  await requireRole("SUPERUSER");
  await db
    .update(githubOrgs)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(githubOrgs.id, id));
  revalidateTag(GITHUB_STATS_TAG, "max");
  revalidatePath(ORG_PATH);
}

/** Delete an org and (via cascade) its repos and contributor stats. */
export async function deleteGithubOrg(id: string): Promise<void> {
  await requireRole("SUPERUSER");
  await db.delete(githubOrgs).where(eq(githubOrgs.id, id));
  revalidateTag(GITHUB_STATS_TAG, "max");
  revalidatePath(ORG_PATH);
}
