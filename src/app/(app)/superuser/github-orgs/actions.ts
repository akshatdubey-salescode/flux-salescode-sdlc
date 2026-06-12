"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { githubOrgs } from "@/lib/db/schema";
import { encrypt } from "@/lib/crypto";
import { GitHubClient } from "@/lib/github/client";
import { GITHUB_STATS_TAG } from "@/lib/github/cache-tags";

const ORG_PATH = "/superuser/github-orgs";

/**
 * Add (or re-key) a GitHub org. Validates the PAT can read the org's repos
 * before persisting it (encrypted). Returns an error string on validation
 * failure so the form can surface it.
 */
export async function addGithubOrg(
  login: string,
  token: string
): Promise<{ error?: string }> {
  const user = await requireRole("SUPERUSER");

  const cleanLogin = login.trim();
  const cleanToken = token.trim();
  if (!cleanLogin) return { error: "Org login is required." };
  if (!cleanToken) return { error: "A token is required." };

  const accessError = await new GitHubClient({
    token: cleanToken,
    org: cleanLogin,
  }).testOrgAccess();
  if (accessError) return { error: accessError };

  await db
    .insert(githubOrgs)
    .values({
      login: cleanLogin,
      apiToken: encrypt(cleanToken),
      isActive: true,
      createdBy: user.id,
    })
    .onConflictDoUpdate({
      target: githubOrgs.login,
      set: { apiToken: encrypt(cleanToken), isActive: true, updatedAt: new Date() },
    });

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
