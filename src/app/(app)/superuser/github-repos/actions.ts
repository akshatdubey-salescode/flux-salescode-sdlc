"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { githubContributorStats, githubRepos } from "@/lib/db/schema";
import { GITHUB_STATS_TAG } from "@/lib/github/cache-tags";
import { buildOrgClients } from "@/lib/github/orgs";

const REPOS_PATH = "/superuser/github-repos";

/**
 * Search a repo's branches straight from GitHub (via its org's PAT), so the
 * superuser picks from real branches instead of typing them by hand. A query
 * prefix-matches server-side, so it finds branches even on repos with thousands
 * of them; an empty query just lists the first page to seed the picker.
 */
export async function searchRepoBranches(
  repoId: string,
  query: string
): Promise<{ branches?: string[]; error?: string }> {
  await requireRole("SUPERUSER");

  const [repo] = await db
    .select({ fullName: githubRepos.fullName, orgId: githubRepos.orgId })
    .from(githubRepos)
    .where(eq(githubRepos.id, repoId))
    .limit(1);
  if (!repo) return { error: "Repo not found." };

  const oc = repo.orgId ? (await buildOrgClients()).get(repo.orgId) : undefined;
  if (!oc) return { error: "No active org/token can read this repo." };

  try {
    return { branches: await oc.client.searchBranches(repo.fullName, query) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Set the extra branches whose lines of code should be folded into a repo, on
 * top of its default branch. GitHub's contributor-stats API only reports the
 * default branch, so configuring extras hands the repo to the git collector
 * (stats_mode='git'): the next `pnpm sync:github` / `pnpm collect:git-stats`
 * clones it and walks `git log` over the union of {default, ...extras}.
 *
 * Clearing the list hands the repo back to the fast API path (stats_mode='api')
 * and drops its existing rows so stale extra-branch lines don't linger until
 * the next sync overwrites them.
 *
 * This only updates config — the actual recompute needs git, which runs in the
 * CLI/worker, not here (and not in the serverless cron).
 */
export async function setRepoExtraBranches(
  repoId: string,
  branches: string[]
): Promise<{ error?: string }> {
  await requireRole("SUPERUSER");

  // Normalise: trim, drop empties, dedupe (case-sensitive — branch names are).
  const clean = [...new Set(branches.map((b) => b.trim()).filter(Boolean))];

  // Guard against obviously bogus refs so a typo can't break `git log`.
  const bad = clean.find((b) => /\s/.test(b) || b.startsWith("-") || b.includes(".."));
  if (bad) return { error: `Invalid branch name: "${bad}"` };

  if (clean.length > 0) {
    await db
      .update(githubRepos)
      .set({ extraBranches: clean, statsMode: "git", updatedAt: new Date() })
      .where(eq(githubRepos.id, repoId));
  } else {
    await db.delete(githubContributorStats).where(eq(githubContributorStats.repoId, repoId));
    await db
      .update(githubRepos)
      .set({ extraBranches: [], statsMode: "api", updatedAt: new Date() })
      .where(eq(githubRepos.id, repoId));
  }

  revalidateTag(GITHUB_STATS_TAG, "max");
  revalidatePath(REPOS_PATH);
  return {};
}
