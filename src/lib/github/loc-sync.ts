// Computes lines-of-code per Jira per quarter and caches it in jira_issue_loc,
// so the scorecard build (build.ts) never has to hit GitHub itself — it only
// reads the cache. Manual-only: a superuser action (performance-review/
// actions.ts, "Sync LOC" button) calls runLocSyncJob directly. No cron —
// deliberately dropped in favor of running it on demand.
//
// Matching rule per Jira: a PR counts when (a) its author resolves to the
// same person as the Jira's assignee, (b) the Jira key appears — case-
// insensitively — in the PR's title or branch name, and (c) the PR was
// created on/after the Jira itself was created. LOC = code-only (whole-line
// comments excluded, see comment-lines.ts) additions + deletions, summed
// across every qualifying PR for that Jira.
//
// (c) is deliberately lenient — no upper bound, no requirement that the PR
// falls inside the Jira's own scoring quarter. A ticket completed in Q1 can
// still have a legitimate trailing PR merged in Q2 (a late fix, a follow-up)
// and it counts: it would be unfair to permanently strip that credit just
// because the ticket's own quarter already closed. The only real requirement
// is temporal sanity — a PR can't be for work on a ticket that didn't exist
// yet.
//
// Rate-limit guard: stops early once the acting client's remaining quota
// drops below RATE_LIMIT_FLOOR, marking the job rate-limited rather than
// racing the token to 0. This is a floor check, not a backoff/retry
// strategy — a deliberate first cut, not the final word on rate-limit
// handling.
//
// Every run is a FULL resync, by design — not incremental. Jira assignees
// change, and new PRs keep landing, so "only add what's new" would leave a
// stale match (an old assignee's PR) sitting in jira_issue_loc forever. A run
// that scans every tracked repo cleanly (no rate-limit cutoff, no per-repo
// errors) replaces the ENTIRE quarter's jira_issue_loc rows with exactly what
// it found — so a Jira that lost its match (reassigned) correctly drops out,
// not just Jiras that gained one. A run that stops early only upserts the
// keys it actually recomputed, so an incomplete pass can't wipe out good data
// from an earlier complete one. Residual gap: if every run in a row happens
// to be incomplete (rate-limited or hitting per-repo errors) before any one
// of them finishes clean, a reassigned Jira's stale match can persist until a
// fully clean run occurs — rare, and self-heals on the next clean run.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  jiraIssues,
  githubAccounts,
  githubPullRequests,
  jiraIssueLoc,
  locSyncJobs,
  users,
} from "@/lib/db/schema";
import { normalizeEmail } from "@/lib/jira/scorecard-fields";
import { quarterFromKey } from "@/lib/scorecard/quarter";
import { PERFORMANCE_SCORECARDS_TAG } from "@/lib/scorecard/cache-tags";
import { revalidateTag } from "next/cache";
import { buildOrgClients } from "./orgs";
import { getTrackedRepos } from "./repos";
import { GitHubClient, type PullRequestRaw } from "./client";
import { countPatchCodeLines } from "./comment-lines";

// Stop pulling from a client once its token has fewer than this many requests
// left — leaves headroom for other jobs sharing the same token this hour.
const RATE_LIMIT_FLOOR = 200;

// Case-insensitive, separator-generous Jira key: project prefix + optional
// dash/underscore/dot/space (or nothing at all) + issue number. Captures the
// prefix and number separately so callers can reassemble the canonical
// "PREFIX-123" form regardless of how the PR author actually wrote it (people
// use dashes, underscores, dots, spaces, or nothing — "SC-123", "SC_123",
// "sc.123", "SC 123", "sc123" should all resolve). A permissive regex here is
// safe: a spurious match only "hits" if it happens to equal a real Jira key
// AND that Jira's assignee matches the PR author AND the dates are in-quarter
// — real false positives are effectively impossible.
const JIRA_KEY_REGEX = /([A-Za-z][A-Za-z0-9]{1,9})[-_.\s]*(\d{1,6})/g;

export type LocSyncResult = {
  quarterKey: string;
  prsScanned: number;
  matchesFound: number;
  rateLimited: boolean;
};

/** Active (pending/running) job for this quarter, if any — dedup guard. */
async function findActiveJob(quarterKey: string): Promise<string | null> {
  const [existing] = await db
    .select({ id: locSyncJobs.id })
    .from(locSyncJobs)
    .where(
      and(
        eq(locSyncJobs.quarterKey, quarterKey),
        inArray(locSyncJobs.status, ["pending", "running"])
      )
    )
    .limit(1);
  return existing?.id ?? null;
}

export type EnqueueLocSyncResult =
  | { jobId: string; queued: true }
  | { jobId: string; existing: true };

/** Dedup: return the active job for this quarter if one exists, else create one. */
export async function enqueueLocSyncJob(quarterKey: string): Promise<EnqueueLocSyncResult> {
  const active = await findActiveJob(quarterKey);
  if (active) return { jobId: active, existing: true };
  const [job] = await db.insert(locSyncJobs).values({ quarterKey, status: "pending" }).returning();
  return { jobId: job.id, queued: true };
}

/** login → app-user email, for resolving a PR's author to a Jira assignee. */
async function loadGithubLoginEmailMap(): Promise<Map<string, string>> {
  const accounts = await db
    .select({ login: githubAccounts.githubLogin, userId: githubAccounts.userId })
    .from(githubAccounts)
    .where(eq(githubAccounts.isBot, false));

  const userIds = accounts.map((a) => a.userId).filter((id): id is string => id != null);
  const userRows = userIds.length
    ? await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, userIds))
    : [];
  const emailById = new Map(userRows.map((u) => [u.id, normalizeEmail(u.email)]));

  const map = new Map<string, string>();
  for (const a of accounts) {
    if (!a.userId) continue;
    const email = emailById.get(a.userId);
    if (email) map.set(a.login, email);
  }
  return map;
}

/** Upsert a PR's cheap list-endpoint fields; returns any already-cached diff stats. */
async function upsertPrListFields(
  repoId: string,
  pr: PullRequestRaw
): Promise<{
  additions: number | null;
  deletions: number | null;
  statsMethod: string | null;
  statsFetchedAt: Date | null;
}> {
  const [row] = await db
    .insert(githubPullRequests)
    .values({
      repoId,
      number: pr.number,
      title: pr.title,
      headRef: pr.head.ref,
      authorLogin: pr.user?.login ?? null,
      state: pr.state,
      createdAt: new Date(pr.created_at),
      mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
      updatedAt: new Date(pr.updated_at),
    })
    .onConflictDoUpdate({
      target: [githubPullRequests.repoId, githubPullRequests.number],
      set: {
        title: pr.title,
        headRef: pr.head.ref,
        authorLogin: pr.user?.login ?? null,
        state: pr.state,
        mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
        updatedAt: new Date(pr.updated_at),
        syncedAt: new Date(),
      },
    })
    .returning({
      additions: githubPullRequests.additions,
      deletions: githubPullRequests.deletions,
      statsMethod: githubPullRequests.statsMethod,
      statsFetchedAt: githubPullRequests.statsFetchedAt,
    });
  return row;
}

const STATS_METHOD_CODE_ONLY = "code_only";

/**
 * Code-only (comments excluded) diff stats for a PR — reused from cache only
 * when it was fetched under the current method (statsMethod = "code_only");
 * a row fetched before comment-exclusion shipped is treated as stale and
 * refetched, not silently reused with the old (comments-included) meaning.
 * Sums countPatchCodeLines across every changed file with a patch; files
 * without one (binary / too-large diff) fall back to GitHub's raw per-file
 * additions/deletions, since there's no patch to classify.
 */
async function ensurePrStats(
  repoId: string,
  repoFullName: string,
  number: number,
  cached: {
    additions: number | null;
    deletions: number | null;
    statsMethod: string | null;
    statsFetchedAt: Date | null;
  },
  client: GitHubClient
): Promise<{ additions: number; deletions: number } | null> {
  if (
    cached.statsFetchedAt &&
    cached.statsMethod === STATS_METHOD_CODE_ONLY &&
    cached.additions != null &&
    cached.deletions != null
  ) {
    return { additions: cached.additions, deletions: cached.deletions };
  }

  const files = await client.getPullRequestFiles(repoFullName, number);
  if (files.length === 0) return null;

  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    if (f.patch) {
      const counted = countPatchCodeLines(f.filename, f.patch);
      additions += counted.additions;
      deletions += counted.deletions;
    } else {
      // No patch to classify (binary / too-large diff) — GitHub's raw counts
      // for this file are the best available signal.
      additions += f.additions;
      deletions += f.deletions;
    }
  }

  await db
    .update(githubPullRequests)
    .set({ additions, deletions, statsMethod: STATS_METHOD_CODE_ONLY, statsFetchedAt: new Date() })
    .where(and(eq(githubPullRequests.repoId, repoId), eq(githubPullRequests.number, number)));
  return { additions, deletions };
}

/**
 * Run one loc-sync pass for a quarter, updating job progress as it goes.
 * Scans every tracked repo's PRs (bounded per-repo by listPullRequests'
 * updated_at floor — the earliest creation date among this quarter's
 * candidate Jiras, not quarter.start, since a ticket can predate its own
 * quarter), matches qualifying PRs to Jiras, and upserts jira_issue_loc per
 * matched Jira. Idempotent and safe to re-run — see the "known gap" note
 * above for the one edge case that isn't fully merged across runs.
 */
export async function runLocSyncJob(jobId: string, quarterKey: string): Promise<LocSyncResult> {
  const quarter = quarterFromKey(quarterKey);
  if (!quarter) throw new Error(`Invalid quarter key: ${quarterKey}`);

  await db
    .update(locSyncJobs)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(locSyncJobs.id, jobId));

  let prsScanned = 0;
  let matchesFound = 0;
  let syncedRepos = 0;
  let errors = 0;
  let rateLimited = false;
  const errorMessages: string[] = [];

  try {
    const issueRows = await db
      .select({
        jiraKey: jiraIssues.jiraKey,
        assigneeEmail: jiraIssues.assigneeEmail,
        completedAt: jiraIssues.completedAt,
        jiraCreatedAt: jiraIssues.jiraCreatedAt,
      })
      .from(jiraIssues);
    const jiraMap = new Map<string, { assigneeEmail: string; createdAt: Date | null }>();
    for (const r of issueRows) {
      if (!r.completedAt) continue;
      const day = r.completedAt.toISOString().slice(0, 10);
      if (day < quarter.start || day > quarter.end) continue;
      const email = normalizeEmail(r.assigneeEmail);
      if (email) jiraMap.set(r.jiraKey.toUpperCase(), { assigneeEmail: email, createdAt: r.jiraCreatedAt });
    }

    // Listing floor: the earliest of this quarter's candidate Jiras' own
    // creation dates, not quarter.start — a ticket completed this quarter can
    // have been created (and had PRs raised against it) well before the
    // quarter began. Falls back to quarter.start when there are no candidates
    // or none have a known creation date, so the scan still has a bound.
    let listingFloor = quarter.start;
    for (const v of jiraMap.values()) {
      if (!v.createdAt) continue;
      const day = v.createdAt.toISOString().slice(0, 10);
      if (day < listingFloor) listingFloor = day;
    }

    const loginEmailMap = await loadGithubLoginEmailMap();
    const orgClients = await buildOrgClients();
    const repos = await getTrackedRepos();

    await db
      .update(locSyncJobs)
      .set({ totalRepos: repos.length })
      .where(eq(locSyncJobs.id, jobId));

    // jiraKey(upper) → running total for THIS run only.
    const agg = new Map<string, { additions: number; deletions: number; prNumbers: number[] }>();

    repoLoop: for (const repo of repos) {
      const client = repo.orgId ? orgClients.get(repo.orgId)?.client : undefined;
      if (!client) continue;

      if ((client.rateLimitRemaining ?? Infinity) < RATE_LIMIT_FLOOR) {
        rateLimited = true;
        break;
      }

      let prs: PullRequestRaw[];
      try {
        const result = await client.listPullRequests(repo.fullName, { updatedSince: listingFloor });
        prs = result.prs;
        if (result.truncated) {
          // More in-quarter PRs than the page ceiling covers — this repo's
          // scan is incomplete, so this run can't count as "fully clean"
          // (see the fullyComplete gate below).
          errors++;
          errorMessages.push(`${repo.fullName}: PR list truncated at the page ceiling`);
        }
      } catch (err) {
        errors++;
        errorMessages.push(`${repo.fullName}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      for (const pr of prs) {
        prsScanned++;
        const cached = await upsertPrListFields(repo.id, pr);

        if ((client.rateLimitRemaining ?? Infinity) < RATE_LIMIT_FLOOR) {
          rateLimited = true;
          break repoLoop;
        }

        const authorLogin = pr.user?.login;
        const authorEmail = authorLogin ? loginEmailMap.get(authorLogin) : undefined;
        if (!authorEmail) continue;

        const candidateKeys = new Set<string>();
        for (const m of `${pr.title} ${pr.head.ref}`.matchAll(JIRA_KEY_REGEX)) {
          candidateKeys.add(`${m[1]}-${m[2]}`.toUpperCase());
        }
        if (candidateKeys.size === 0) continue;

        const prCreatedAt = new Date(pr.created_at);

        for (const key of candidateKeys) {
          const candidate = jiraMap.get(key);
          if (!candidate || candidate.assigneeEmail !== authorEmail) continue;
          // Lenient floor only — no quarter-alignment requirement. A PR
          // created before the Jira itself existed can't be legitimate work
          // on it; anything after (no matter how much later) counts.
          if (candidate.createdAt && prCreatedAt < candidate.createdAt) continue;

          const stats = await ensurePrStats(repo.id, repo.fullName, pr.number, cached, client);
          if (!stats) continue;

          matchesFound++;
          const entry = agg.get(key) ?? { additions: 0, deletions: 0, prNumbers: [] };
          entry.additions += stats.additions;
          entry.deletions += stats.deletions;
          entry.prNumbers.push(pr.number);
          agg.set(key, entry);
        }
      }

      syncedRepos++;
      await db
        .update(locSyncJobs)
        .set({ syncedRepos, prsScanned, matchesFound, errorCount: errors, errorMessages })
        .where(eq(locSyncJobs.id, jobId));
    }

    // Every run is a FULL resync of the quarter (not an incremental delta) —
    // assignees can change on a Jira after PRs were already matched to it, and
    // new PRs keep landing, so "only add what's new" would let a stale match
    // (old assignee, no longer current) sit in jira_issue_loc forever. A run
    // that finished cleanly (every tracked repo listed, no rate-limit cutoff)
    // saw the complete, current picture — so it's safe to REPLACE the whole
    // quarter's rows with exactly what this run found, dropping any key that
    // no longer matches (e.g. reassigned Jira). A run that stopped early only
    // touches the keys it actually recomputed, so unscanned repos' existing
    // LOC isn't wiped by an incomplete pass.
    const fullyComplete = !rateLimited && errors === 0;
    if (fullyComplete) {
      await db.transaction(async (tx) => {
        await tx.delete(jiraIssueLoc).where(eq(jiraIssueLoc.quarterKey, quarterKey));
        const rows = [...agg.entries()].map(([jiraKey, v]) => ({
          jiraKey,
          quarterKey,
          totalAdditions: v.additions,
          totalDeletions: v.deletions,
          prCount: v.prNumbers.length,
          prNumbers: v.prNumbers,
          computedAt: new Date(),
        }));
        for (let i = 0; i < rows.length; i += 500) {
          await tx.insert(jiraIssueLoc).values(rows.slice(i, i + 500));
        }
      });
    } else {
      for (const [jiraKey, v] of agg) {
        await db
          .insert(jiraIssueLoc)
          .values({
            jiraKey,
            quarterKey,
            totalAdditions: v.additions,
            totalDeletions: v.deletions,
            prCount: v.prNumbers.length,
            prNumbers: v.prNumbers,
            computedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [jiraIssueLoc.jiraKey, jiraIssueLoc.quarterKey],
            set: {
              totalAdditions: v.additions,
              totalDeletions: v.deletions,
              prCount: v.prNumbers.length,
              prNumbers: v.prNumbers,
              computedAt: new Date(),
            },
          });
      }
    }

    await db
      .update(locSyncJobs)
      .set({
        status: "completed",
        completedAt: new Date(),
        syncedRepos,
        prsScanned,
        matchesFound,
        rateLimited,
        errorCount: errors,
        errorMessages,
      })
      .where(eq(locSyncJobs.id, jobId));

    // The scorecard leaderboard/drill-down read the same cache tag, so a
    // fresh LOC sync should invalidate them too (complexity-mismatch flags
    // depend on this data).
    revalidateTag(PERFORMANCE_SCORECARDS_TAG, "max");

    return { quarterKey, prsScanned, matchesFound, rateLimited };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(locSyncJobs)
      .set({
        status: "failed",
        completedAt: new Date(),
        prsScanned,
        matchesFound,
        errorCount: errors + 1,
        errorMessages: [...errorMessages, `Fatal: ${msg}`],
      })
      .where(eq(locSyncJobs.id, jobId));
    throw err;
  }
}
