import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";
import { githubAccounts, users } from "@/lib/db/schema";
import { MY_GITHUB_ACTIVITY_TAG } from "@/lib/github/cache-tags";

export async function GET() {
  try {
    const user = await requireAuth();
    return NextResponse.json(await fetchMyGithubActivity(user.email));
  } catch (error) {
    console.error("My GitHub activity error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

export type MyGithubActivity = {
  /** unmapped=true means this person has no linked GitHub account at all
   *  (github_accounts.user_id) — the LOC Sync Status panel can't match
   *  anything to them without one. */
  unmapped: boolean;
  /** The signed-in user's own email — lets the client feed LocSyncStatusPanel without re-deriving it. */
  email: string;
};

/** Whether the signed-in user has a linked (non-bot) GitHub account at all. */
async function fetchMyGithubActivity(userEmail: string): Promise<MyGithubActivity> {
  "use cache";
  cacheLife("minutes");
  cacheTag(MY_GITHUB_ACTIVITY_TAG, `github-my-activity:${userEmail}`);

  // users.email (and users.id, which is the same value) is always stored
  // already-lowercased at insert time (see getCurrentUser in auth/server.ts),
  // and requireAuth() returns that stored value — no lower() needed here.
  const accounts = await db
    .select({ login: githubAccounts.githubLogin })
    .from(githubAccounts)
    .innerJoin(users, eq(users.id, githubAccounts.userId))
    .where(and(eq(users.email, userEmail), eq(githubAccounts.isBot, false)));

  return { unmapped: accounts.length === 0, email: userEmail };
}
