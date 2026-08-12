import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";
import {
  githubAccounts,
  githubPullRequests,
  githubRepos,
  users,
} from "@/lib/db/schema";

export async function GET() {
  try {
    const user = await requireAuth();
    return NextResponse.json(await fetchMyGithubActivity(user.email));
  } catch (error) {
    console.error("My GitHub activity error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

export type MyOpenPullRequest = {
  number: number;
  title: string;
  headRef: string;
  createdAt: string;
  daysOpen: number;
  additions: number | null;
  deletions: number | null;
  repoFullName: string;
};

export type MyGithubActivity = {
  unmapped: boolean;
  pullRequests: MyOpenPullRequest[];
  lastSyncedAt: string | null;
};

/**
 * The signed-in user's currently-open pull requests, oldest first (the ones
 * most worth a nudge). Sourced from github_pull_requests, which is only ever
 * populated by a superuser's manual "Sync LOC" run (no cron — see loc-sync.ts)
 * — so this can lag behind reality by however long it's been since the last
 * sync. lastSyncedAt is returned alongside the list so the UI can say so
 * honestly instead of implying a live view. unmapped=true means this person
 * has no linked GitHub account at all (github_accounts.user_id), which reads
 * very differently from "zero open PRs" — the UI must distinguish the two.
 */
async function fetchMyGithubActivity(userEmail: string): Promise<MyGithubActivity> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`github-my-activity:${userEmail}`);

  // users.email (and users.id, which is the same value) is always stored
  // already-lowercased at insert time (see getCurrentUser in auth/server.ts),
  // and requireAuth() returns that stored value — no lower() needed here.
  const accounts = await db
    .select({ login: githubAccounts.githubLogin })
    .from(githubAccounts)
    .innerJoin(users, eq(users.id, githubAccounts.userId))
    .where(and(eq(users.email, userEmail), eq(githubAccounts.isBot, false)));

  const logins = accounts.map((a) => a.login);
  if (logins.length === 0) {
    return { unmapped: true, pullRequests: [], lastSyncedAt: null };
  }

  const [prs, [syncRow]] = await Promise.all([
    db
      .select({
        number: githubPullRequests.number,
        title: githubPullRequests.title,
        headRef: githubPullRequests.headRef,
        createdAt: githubPullRequests.createdAt,
        additions: githubPullRequests.additions,
        deletions: githubPullRequests.deletions,
        repoFullName: githubRepos.fullName,
      })
      .from(githubPullRequests)
      .innerJoin(githubRepos, eq(githubRepos.id, githubPullRequests.repoId))
      .where(and(eq(githubPullRequests.state, "open"), inArray(githubPullRequests.authorLogin, logins)))
      .orderBy(githubPullRequests.createdAt),
    db
      .select({ syncedAt: sql<string | null>`max(${githubPullRequests.syncedAt})` })
      .from(githubPullRequests),
  ]);

  const now = Date.now();
  return {
    unmapped: false,
    pullRequests: prs.map((pr) => ({
      ...pr,
      createdAt: pr.createdAt.toISOString(),
      daysOpen: Math.floor((now - pr.createdAt.getTime()) / 86_400_000),
    })),
    lastSyncedAt: syncRow?.syncedAt ?? null,
  };
}
