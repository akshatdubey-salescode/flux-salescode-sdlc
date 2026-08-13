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
import { and, eq, ilike, inArray, or } from "drizzle-orm";
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

  const issueRows = await db
    .select({
      jiraKey: jiraIssues.jiraKey,
      summary: jiraIssues.summary,
      assigneeEmail: jiraIssues.assigneeEmail,
      completedAt: jiraIssues.completedAt,
      jiraCreatedAt: jiraIssues.jiraCreatedAt,
      customFields: jiraIssues.customFields,
      devOwnerFieldIds: jiraProjects.devOwnerFieldIds,
      jiraBaseUrl: jiraProjects.jiraBaseUrl,
    })
    .from(jiraIssues)
    .innerJoin(jiraProjects, eq(jiraIssues.projectId, jiraProjects.id));

  const candidates: Candidate[] = [];
  for (const r of issueRows) {
    if (!r.completedAt) continue;
    const day = r.completedAt.toISOString().slice(0, 10);
    if (day < quarter.start || day > quarter.end) continue;

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
   * by cross-referencing github_pull_requests for ones authored by the
   * credited person's linked GitHub login(s) whose title/branch reference
   * this Jira key — the same two signals loc-sync.ts itself matched on, so
   * this reliably disambiguates even if the same PR number exists in more
   * than one tracked repo.
   */
  async function resolvePrLinks(jiraKey: string, prNumbers: number[], creditedEmail: string): Promise<PrLink[]> {
    if (prNumbers.length === 0) return [];
    const logins = await getGithubLoginsForEmail(creditedEmail);
    if (logins.size === 0) return [];

    const prRows = await db
      .select({
        repoFullName: githubRepos.fullName,
        number: githubPullRequests.number,
        authorLogin: githubPullRequests.authorLogin,
      })
      .from(githubPullRequests)
      .innerJoin(githubRepos, eq(githubRepos.id, githubPullRequests.repoId))
      .where(
        and(
          inArray(githubPullRequests.number, prNumbers),
          or(
            ilike(githubPullRequests.title, `%${jiraKey}%`),
            ilike(githubPullRequests.headRef, `%${jiraKey}%`)
          )
        )
      );

    return prRows
      .filter((p) => p.authorLogin && logins.has(p.authorLogin))
      .map((p) => ({
        repoFullName: p.repoFullName,
        number: p.number,
        url: `https://github.com/${p.repoFullName}/pull/${p.number}/files`,
      }));
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

  const rows: LocSyncStatusRow[] = [];
  for (const c of candidates) {
    const loc = locByKey.get(c.jiraKey);

    if (loc && normalizeEmail(loc.creditedEmail) === targetEmail) {
      rows.push({
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
      });
      continue;
    }

    if (loc && loc.creditedEmail) {
      rows.push({
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
      });
      continue;
    }

    rows.push({
      jiraKey: c.jiraKey,
      summary: c.summary,
      jiraUrl: c.jiraUrl,
      status: "not_synced",
      reason: await diagnoseNotSynced(c, hasLinkedGithub, employeeGithubLogins),
      additions: null,
      deletions: null,
      prCount: null,
      creditedEmail: null,
      prLinks: [],
    });
  }

  return rows.sort((a, b) => a.jiraKey.localeCompare(b.jiraKey));
}

/**
 * Why one Jira never got a jira_issue_loc row — checked in the same order
 * loc-sync.ts's own matching pipeline would hit a wall, using only what's
 * already synced into Postgres (no live GitHub calls).
 */
async function diagnoseNotSynced(
  candidate: Candidate,
  hasLinkedGithub: boolean,
  employeeGithubLogins: Set<string>
): Promise<string> {
  if (!hasLinkedGithub) {
    return "Your GitHub account isn't linked in Flux — PRs can't be matched to you.";
  }

  const prRows = await db
    .select({
      authorLogin: githubPullRequests.authorLogin,
      createdAt: githubPullRequests.createdAt,
    })
    .from(githubPullRequests)
    .innerJoin(githubRepos, eq(githubRepos.id, githubPullRequests.repoId))
    .where(
      or(
        ilike(githubPullRequests.title, `%${candidate.jiraKey}%`),
        ilike(githubPullRequests.headRef, `%${candidate.jiraKey}%`)
      )
    );

  if (prRows.length === 0) {
    return "No PR found referencing this Jira key in its title or branch.";
  }

  const yours = prRows.filter((p) => p.authorLogin && employeeGithubLogins.has(p.authorLogin));
  if (yours.length === 0) {
    const authors = [...new Set(prRows.map((p) => p.authorLogin).filter((l): l is string => !!l))];
    return `Matching PR(s) found, but authored by ${authors.join(", ") || "someone else"}, not you.`;
  }

  const eligible = candidate.jiraCreatedAt
    ? yours.some((p) => p.createdAt >= candidate.jiraCreatedAt!)
    : true;
  return eligible
    ? "Matching PR found and looks eligible — should be picked up by the next LOC sync run."
    : "Your matching PR(s) were created before this Jira existed.";
}
