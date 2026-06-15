"use server";

import { revalidateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { assignAccountToUser } from "@/lib/github/identity";
import { GITHUB_STATS_TAG } from "@/lib/github/cache-tags";

/**
 * Map a GitHub account to an app user (resolved_via = 'manual'), or clear the
 * mapping when userId is empty. Invalidates the lines-of-code dashboard cache.
 */
export async function assignGithubAccount(
  githubLogin: string,
  userId: string
): Promise<{ error?: string }> {
  await requireRole("SUPERUSER");

  if (userId) {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return { error: `Unknown user: "${userId}".` };
  }

  await assignAccountToUser(githubLogin, userId || null);
  revalidateTag(GITHUB_STATS_TAG, "max");
  return {};
}
