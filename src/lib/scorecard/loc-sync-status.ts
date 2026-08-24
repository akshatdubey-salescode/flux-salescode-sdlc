// Per-employee, per-quarter LOC-sync diagnostic — answers "which of my
// completed Jiras got their LOC synced, and if not, why not". Reuses only
// already-synced Postgres data (github_pull_requests/github_accounts) rather
// than calling GitHub again, so this is fast enough to run on a button click.
//
// Candidate population mirrors loc-sync.ts's own jiraMap construction (every
// completed-in-quarter Jira, credited via the same Dev-Owner-else-Assignee
// resolution build.ts uses) — see resolveTaskOwnerEmail (scorecard-fields.ts)
// and resolvePrCredit (loc-sync.ts) for the two places this logic is mirrored
// from.
//
// The PR search is a single batched query covering every candidate Jira at
// once (not one query per Jira) — this repo's DB pool is deliberately capped
// at 5 connections (shared across serverless instances), so an employee with
// 100+ completed Jiras would otherwise queue behind that cap one Jira at a
// time regardless of how "parallel" the calling code looks.
import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  jiraIssues,
  jiraProjects,
  jiraIssueLoc,
  githubPullRequests,
  githubRepos,
  githubAccounts,
  users,
} from "@/lib/db/schema";
import { normalizeEmail, extractIssueOwnerEmail } from "@/lib/jira/scorecard-fields";
import { loadAccountIdEmailMap } from "@/lib/jira/identity";
import { quarterFromKey } from "@/lib/scorecard/quarter";
import { extractCandidateJiraKeys } from "@/lib/github/loc-sync";

export type LocSyncStatus = "synced" | "credited_elsewhere" | "not_synced";

export type PrLink = { repoFullName: string; number: number; url: string };

export type LocSyncStatusRow = {
  jiraKey: string;
  summary: string;
  jiraUrl?: string;
  status: LocSyncStatus;
  reason: string | null;
  additions: number | null;
  deletions: number | null;
  prCount: number | null;
  creditedEmail: string | null;
  /** The actual (repo, PR number) pairs behind additions/deletions — empty for not_synced rows. */
  prLinks: PrLink[];
};

type Candidate = {
  jiraKey: string;
  summary: string;
  jiraCreatedAt: Date | null;
  jiraUrl?: string;
};

type CandidatePr = {
  repoFullName: string;
  number: number;
  authorLogin: string | null;
  createdAt: Date;
  title: string;
  headRef: string;
};

/**
 * Every completed-in-quarter Jira credited to `email` (as Assignee or Dev
 * Owner), cross-referenced against jira_issue_loc, with a diagnosed reason
 * for any that never got a LOC row.
 */
export async function getLocSyncStatus(email: string, quarterKey: string): Promise<LocSyncStatusRow[]> {
  const quarter = quarterFromKey(quarterKey);
  if (!quarter) throw new Error(`Invalid quarter key: ${quarterKey}`);
  const targetEmail = normalizeEmail(email);
  if (!targetEmail) throw new Error("Invalid email");

  const accountIdEmailMap = await loadAccountIdEmailMap();

  // Push the quarter's date range down to SQL — this table holds every
  // synced Jira across every project ever (tens of thousands of rows), and
  // fetching all of them just to filter by date in JS was, by far, the
  // dominant cost here (~9s of a ~9.1s total run against production data;
  // everything else in this function combined took well under 100ms).
  const quarterStart = new Date(`${quarter.start}T00:00:00.000Z`);
  const quarterEndExclusive = new Date(new Date(`${quarter.end}T00:00:00.000Z`).getTime() + 86_400_000);

  const issueRows = await db
    .select({
      jiraKey: jiraIssues.jiraKey,
      summary: jiraIssues.summary,
      assigneeEmail: jiraIssues.assigneeEmail,
      jiraCreatedAt: jiraIssues.jiraCreatedAt,
      customFields: jiraIssues.customFields,
      devOwnerFieldIds: jiraProjects.devOwnerFieldIds,
      jiraBaseUrl: jiraProjects.jiraBaseUrl,
    })
    .from(jiraIssues)
    .innerJoin(jiraProjects, eq(jiraIssues.projectId, jiraProjects.id))
    .where(
      and(
        isNotNull(jiraIssues.completedAt),
        gte(jiraIssues.completedAt, quarterStart),
        lt(jiraIssues.completedAt, quarterEndExclusive)
      )
    );

  const candidates: Candidate[] = [];
  for (const r of issueRows) {
    const assignee = normalizeEmail(r.assigneeEmail);
    const devOwner = extractIssueOwnerEmail(r.customFields, r.devOwnerFieldIds, accountIdEmailMap);
    // Either role can end up crediting this person via jira_issue_loc's own
    // Dev-Owner-preferred reduction (see resolvePrCredit) — so both count as
    // "this is one of their Jiras" for the purposes of this report.
    if (assignee !== targetEmail && devOwner !== targetEmail) continue;

    candidates.push({
      jiraKey: r.jiraKey.toUpperCase(),
      summary: r.summary,
      jiraCreatedAt: r.jiraCreatedAt,
      jiraUrl: `${r.jiraBaseUrl.replace(/\/+$/, "")}/browse/${r.jiraKey}`,
    });
  }

  if (candidates.length === 0) return [];

  const keys = candidates.map((c) => c.jiraKey);
  const locRows = await db
    .select({
      jiraKey: jiraIssueLoc.jiraKey,
      totalAdditions: jiraIssueLoc.totalAdditions,
      totalDeletions: jiraIssueLoc.totalDeletions,
      prCount: jiraIssueLoc.prCount,
      prNumbers: jiraIssueLoc.prNumbers,
      creditedEmail: jiraIssueLoc.creditedEmail,
    })
    .from(jiraIssueLoc)
    .where(and(eq(jiraIssueLoc.quarterKey, quarterKey), inArray(jiraIssueLoc.jiraKey, keys)));
  const locByKey = new Map(locRows.map((l) => [l.jiraKey.toUpperCase(), l]));

  // One query for every candidate's PR search, not one query per candidate.
  // Jira keys never contain regex metacharacters ([A-Z][A-Z0-9]*-[0-9]+), but
  // escaped defensively anyway since this becomes a live Postgres regex.
  const keyPattern = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const allPrRows = await db
    .select({
      repoFullName: githubRepos.fullName,
      number: githubPullRequests.number,
      authorLogin: githubPullRequests.authorLogin,
      createdAt: githubPullRequests.createdAt,
      title: githubPullRequests.title,
      headRef: githubPullRequests.headRef,
    })
    .from(githubPullRequests)
    .innerJoin(githubRepos, eq(githubRepos.id, githubPullRequests.repoId))
    .where(sql`(${githubPullRequests.title} ~* ${keyPattern} OR ${githubPullRequests.headRef} ~* ${keyPattern})`);

  // Bucket by the REAL key(s) each PR actually contains — exact regex
  // extraction, the same function loc-sync.ts itself matched on — never by
  // "the pattern happened to hit somewhere in the title". This is what
  // guards against a numeric-prefix collision: the Postgres regex above is
  // just a broad prefilter, e.g. it'll also return a PR titled "Fixes AB-10"
  // for a search that included "AB-1", but that PR only ever lands in this
  // map's "AB-10" bucket, never "AB-1"'s.
  const prsByKey = new Map<string, CandidatePr[]>();
  for (const pr of allPrRows) {
    for (const key of extractCandidateJiraKeys(`${pr.title} ${pr.headRef}`)) {
      const list = prsByKey.get(key);
      if (list) list.push(pr);
      else prsByKey.set(key, [pr]);
    }
  }

  // Does this person have ANY linked (non-bot) GitHub account at all? If not,
  // every "not synced" Jira below shares the same root cause, so check this
  // once up front rather than per-Jira.
  const accountRows = await db
    .select({ githubLogin: githubAccounts.githubLogin })
    .from(githubAccounts)
    .innerJoin(users, eq(users.id, githubAccounts.userId))
    .where(and(eq(users.email, targetEmail), eq(githubAccounts.isBot, false)));
  const employeeGithubLogins = new Set(accountRows.map((a) => a.githubLogin));
  const hasLinkedGithub = employeeGithubLogins.size > 0;

  // Cached per creditedEmail (usually just the target employee, but a
  // credited_elsewhere row needs a different person's logins) so repeated
  // Jiras credited to the same person don't re-query.
  const loginsByEmail = new Map<string, Set<string>>();
  async function getGithubLoginsForEmail(creditedEmail: string): Promise<Set<string>> {
    const key = normalizeEmail(creditedEmail) ?? creditedEmail;
    if (key === targetEmail) return employeeGithubLogins;
    const cached = loginsByEmail.get(key);
    if (cached) return cached;
    const rows = await db
      .select({ githubLogin: githubAccounts.githubLogin })
      .from(githubAccounts)
      .innerJoin(users, eq(users.id, githubAccounts.userId))
      .where(and(eq(users.email, key), eq(githubAccounts.isBot, false)));
    const logins = new Set(rows.map((r) => r.githubLogin));
    loginsByEmail.set(key, logins);
    return logins;
  }

  /**
   * Resolves jira_issue_loc's own prNumbers (bare integers, not repo-scoped —
   * PR numbers are only unique per-repo) back to actual (repo, number) pairs,
   * using the pre-fetched prsByKey bucket for this Jira and the credited
   * person's linked GitHub login(s) — the same two signals loc-sync.ts
   * itself matched on, so this reliably disambiguates even if the same PR
   * number exists in more than one tracked repo.
   */
  async function resolvePrLinks(jiraKey: string, prNumbers: number[], creditedEmail: string): Promise<PrLink[]> {
    if (prNumbers.length === 0) return [];
    const logins = await getGithubLoginsForEmail(creditedEmail);
    if (logins.size === 0) return [];

    return (prsByKey.get(jiraKey) ?? [])
      .filter((p) => prNumbers.includes(p.number) && p.authorLogin && logins.has(p.authorLogin))
      .map((p) => ({
        repoFullName: p.repoFullName,
        number: p.number,
        url: `https://github.com/${p.repoFullName}/pull/${p.number}/files`,
      }));
  }

  const rows: LocSyncStatusRow[] = await Promise.all(
    candidates.map(async (c): Promise<LocSyncStatusRow> => {
      const loc = locByKey.get(c.jiraKey);

      if (loc && normalizeEmail(loc.creditedEmail) === targetEmail) {
        return {
          jiraKey: c.jiraKey,
          summary: c.summary,
          jiraUrl: c.jiraUrl,
          status: "synced",
          reason: null,
          additions: loc.totalAdditions,
          deletions: loc.totalDeletions,
          prCount: loc.prCount,
          creditedEmail: loc.creditedEmail,
          prLinks: await resolvePrLinks(c.jiraKey, loc.prNumbers, loc.creditedEmail ?? targetEmail),
        };
      }

      if (loc && loc.creditedEmail) {
        return {
          jiraKey: c.jiraKey,
          summary: c.summary,
          jiraUrl: c.jiraUrl,
          status: "credited_elsewhere",
          reason: `Credited to ${loc.creditedEmail} instead (Dev Owner takes precedence over Assignee when both have a qualifying PR)`,
          additions: loc.totalAdditions,
          deletions: loc.totalDeletions,
          prCount: loc.prCount,
          creditedEmail: loc.creditedEmail,
          prLinks: await resolvePrLinks(c.jiraKey, loc.prNumbers, loc.creditedEmail),
        };
      }

      return {
        jiraKey: c.jiraKey,
        summary: c.summary,
        jiraUrl: c.jiraUrl,
        status: "not_synced",
        reason: diagnoseNotSynced(c, hasLinkedGithub, employeeGithubLogins, prsByKey),
        additions: null,
        deletions: null,
        prCount: null,
        creditedEmail: null,
        prLinks: [],
      };
    })
  );

  return rows.sort((a, b) => a.jiraKey.localeCompare(b.jiraKey));
}

/**
 * Why one Jira never got a jira_issue_loc row — checked in the same order
 * loc-sync.ts's own matching pipeline would hit a wall, using only the
 * pre-fetched, exact-matched prsByKey bucket (no DB call here at all).
 */
function diagnoseNotSynced(
  candidate: Candidate,
  hasLinkedGithub: boolean,
  employeeGithubLogins: Set<string>,
  prsByKey: Map<string, CandidatePr[]>
): string {
  if (!hasLinkedGithub) {
    return "Your GitHub account isn't linked in Flux — PRs can't be matched to you.";
  }

  const matching = prsByKey.get(candidate.jiraKey) ?? [];
  if (matching.length === 0) {
    return "No PR found referencing this Jira key in its title or branch.";
  }

  const yours = matching.filter((p) => p.authorLogin && employeeGithubLogins.has(p.authorLogin));
  if (yours.length === 0) {
    const authors = [...new Set(matching.map((p) => p.authorLogin).filter((l): l is string => !!l))];
    return `Matching PR(s) found, but authored by ${authors.join(", ") || "someone else"}, not you.`;
  }

  const eligible = candidate.jiraCreatedAt
    ? yours.some((p) => p.createdAt >= candidate.jiraCreatedAt!)
    : true;
  return eligible
    ? "Matching PR found and looks eligible — should be picked up by the next LOC sync run."
    : "Your matching PR(s) were created before this Jira existed.";
}
