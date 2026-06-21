import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraIssues, jiraProjects } from "@/lib/db/schema";
import { loadAccountIdEmailMap } from "@/lib/jira/identity";
import {
  extractIssueOwnerEmail,
  extractIssueOwnerName,
  normalizeEmail,
} from "@/lib/jira/scorecard-fields";
import {
  BUG_ISSUE_TYPES,
  BUG_INVALID_STATUSES,
  normalizeStatus,
} from "@/lib/scorecard/config";
import {
  resolveEnvironment,
  priorityBucket,
  UNASSIGNED_OWNER,
  type BugRow,
} from "@/lib/bug-summary";

// Bug-family issue types only (bug / defect / sub-bug), case-insensitive.
const bugTypeCondition = sql`lower(trim(${jiraIssues.issueType})) in (${sql.join(
  [...BUG_ISSUE_TYPES].map((t) => sql`${t}`),
  sql`, `
)})`;

/** Restrict to bugs raised (created) within an inclusive YYYY-MM-DD range. */
export function dateRangeConditions(start: string, end: string): SQL[] {
  return [
    sql`${jiraIssues.jiraCreatedAt} is not null`,
    sql`${jiraIssues.jiraCreatedAt}::date >= ${start}::date`,
    sql`${jiraIssues.jiraCreatedAt}::date <= ${end}::date`,
  ];
}

/** All accountIds we know for the given emails (reverse of the identity map). */
async function accountIdsForEmails(emails: string[]): Promise<string[]> {
  const want = new Set(emails.map((e) => e.toLowerCase()));
  const map = await loadAccountIdEmailMap(); // accountId -> email
  const out: string[] = [];
  for (const [accountId, email] of map) {
    if (want.has(email)) out.push(accountId);
  }
  return out;
}

/**
 * SQL candidate superset for "owner ∈ these people". Owner resolves to the
 * Issue Owner field, falling back to the primary assignee, so we match either:
 *   - primary assignee is one of the emails (covers the assignee fallback), OR
 *   - the issue-owner user object lives in custom_fields and references the
 *     person's accountId (always present, even when their email is hidden) or
 *     email.
 * This is intentionally loose — loadBugRows then post-filters on the exact
 * resolved ownerEmail, which removes the false positives (e.g. assigned-to-me
 * but owned-by-someone-else) and any unrelated custom-field matches.
 */
export async function ownedByConditions(emails: string[]): Promise<SQL> {
  const lower = emails.map((e) => e.toLowerCase());
  const accountIds = await accountIdsForEmails(lower);

  const clauses: SQL[] = [];
  if (lower.length) clauses.push(inArray(jiraIssues.assigneeEmail, lower));
  for (const token of [...accountIds, ...lower]) {
    clauses.push(sql`${jiraIssues.customFields}::text ILIKE ${`%${token}%`}`);
  }
  return or(...clauses)!;
}

/**
 * Load bug rows across one or more projects, resolving owner (Issue Owner field
 * → assignee) and environment per project. Shared by every bug-tracker scope
 * (single project, My Bugs, team board) so they all produce identical BugRows.
 * The caller supplies the scope + date conditions; the bug-type filter is added
 * here.
 */
export async function loadBugRows(
  conditions: SQL[],
  restrictToOwners?: string[]
): Promise<BugRow[]> {
  const accountIdEmailMap = await loadAccountIdEmailMap();

  const rows = await db
    .select({
      id: jiraIssues.id,
      jiraKey: jiraIssues.jiraKey,
      summary: jiraIssues.summary,
      status: jiraIssues.status,
      statusCategory: jiraIssues.statusCategory,
      priority: jiraIssues.priority,
      assigneeEmail: jiraIssues.assigneeEmail,
      assigneeName: jiraIssues.assigneeName,
      customFields: jiraIssues.customFields,
      jiraCreatedAt: jiraIssues.jiraCreatedAt,
      jiraUpdatedAt: jiraIssues.jiraUpdatedAt,
      issueOwnerFieldIds: jiraProjects.issueOwnerFieldIds,
      environmentFieldIds: jiraProjects.environmentFieldIds,
      jiraBaseUrl: jiraProjects.jiraBaseUrl,
      projectKey: jiraProjects.jiraProjectKey,
      projectName: jiraProjects.name,
    })
    .from(jiraIssues)
    .innerJoin(jiraProjects, eq(jiraIssues.projectId, jiraProjects.id))
    .where(and(bugTypeCondition, ...conditions));

  const mapped = rows.map((r): BugRow => {
    const ownerEmail =
      extractIssueOwnerEmail(r.customFields, r.issueOwnerFieldIds, accountIdEmailMap) ??
      normalizeEmail(r.assigneeEmail);
    const ownerName =
      extractIssueOwnerName(r.customFields, r.issueOwnerFieldIds) ??
      r.assigneeName ??
      UNASSIGNED_OWNER;
    const environment = resolveEnvironment(
      r.customFields as Record<string, unknown> | null,
      r.environmentFieldIds
    );

    return {
      id: r.id,
      jiraKey: r.jiraKey,
      summary: r.summary,
      projectKey: r.projectKey,
      projectName: r.projectName,
      jiraBaseUrl: r.jiraBaseUrl,
      status: r.status,
      statusCategory: r.statusCategory,
      priority: r.priority,
      priorityBucket: priorityBucket(r.priority),
      environment,
      ownerName,
      ownerEmail,
      isOpen: (r.statusCategory ?? "").trim().toLowerCase() !== "done",
      isInvalid: BUG_INVALID_STATUSES.has(normalizeStatus(r.status)),
      jiraCreatedAt: r.jiraCreatedAt ? r.jiraCreatedAt.toISOString() : null,
      jiraUpdatedAt: r.jiraUpdatedAt ? r.jiraUpdatedAt.toISOString() : null,
    };
  });

  // Keep only bugs whose resolved owner is in scope. This is what makes "My
  // Bugs" / a team's bugs mean *owned by*, not merely *assigned to* — a bug
  // assigned to me but owned by someone else is dropped here.
  if (restrictToOwners && restrictToOwners.length) {
    const owners = new Set(restrictToOwners.map((e) => e.toLowerCase()));
    return mapped.filter((b) => b.ownerEmail != null && owners.has(b.ownerEmail));
  }
  return mapped;
}
