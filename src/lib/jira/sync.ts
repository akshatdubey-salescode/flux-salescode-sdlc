import { eq, and, sql, lt, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  jiraProjects,
  jiraIssues,
  jiraAssigneeChanges,
  projectStatusMappings,
} from "@/lib/db/schema";
import { JiraClient, type JiraIssueRaw } from "./client";
import {
  computeRollup,
  applyTransition,
  extractAssigneeChanges,
  deriveAssigneeSince,
} from "./changelog";
import { decrypt } from "@/lib/crypto";
import { loadAccountIdEmailMap } from "./identity";

/**
 * Raw status names for a project that map to the DONE canonical status.
 * Used to detect completion transitions when building the per-issue rollup.
 */
export async function getDoneRawStatuses(projectId: string): Promise<Set<string>> {
  const rows = await db
    .select({ rawStatus: projectStatusMappings.rawStatus })
    .from(projectStatusMappings)
    .where(
      and(
        eq(projectStatusMappings.projectId, projectId),
        eq(projectStatusMappings.canonicalStatus, "DONE")
      )
    );
  return new Set(rows.map((r) => r.rawStatus));
}

const SYNC_CONCURRENCY = 5;

// Issue fields we map onto dedicated columns; everything else is captured in
// the customFields JSONB blob. Hoisted to module scope so the hot upsertIssue
// path (webhook + every synced issue) doesn't rebuild the Set on each call.
const KNOWN_ISSUE_FIELDS = new Set([
  "summary",
  "description",
  "status",
  "issuetype",
  "priority",
  "assignee",
  "reporter",
  "labels",
  "created",
  "updated",
  "comment",
]);

// ---------------------------------------------------------------------------
// Project sync — bulk fetch all issues and upsert into the database
// ---------------------------------------------------------------------------

export type SyncResult = {
  synced: number;
  errors: number;
  errorMessages: string[];
  pruned: number;
};

export type PruneResult = {
  pruned: number;
  prunedKeys: string[];
  affectedEmails: string[];
};

/**
 * Reconciliation: delete rows for issues that no longer exist in Jira.
 *
 * Webhooks are the primary deletion signal, but delivery is best-effort — a
 * missed issue_deleted (downtime, timeout, secret mismatch) or a move to an
 * untracked Jira project leaves a permanent zombie row. This runs after a
 * full sync as the safety net.
 *
 * Callers must only invoke this after ALL pages were fetched successfully —
 * a partial fetch would make unseen live issues look deleted. Two further
 * guards here:
 *  - Only rows untouched by this sync (synced_at < syncStartedAt) are
 *    candidates, so an issue created mid-sync and inserted by a concurrent
 *    webhook is never pruned.
 *  - An empty fetch against a non-empty mirror is treated as suspicious
 *    (revoked permissions / bad JQL would look exactly like that) and skipped
 *    rather than wiping the project.
 */
export async function pruneIssuesMissingFromJira(
  projectId: string,
  seenJiraIds: Set<string>,
  syncStartedAt: Date
): Promise<PruneResult> {
  const empty: PruneResult = { pruned: 0, prunedKeys: [], affectedEmails: [] };

  const candidates = await db
    .select({
      id: jiraIssues.id,
      jiraId: jiraIssues.jiraId,
      jiraKey: jiraIssues.jiraKey,
      assigneeEmail: jiraIssues.assigneeEmail,
      additionalAssigneeEmails: jiraIssues.additionalAssigneeEmails,
    })
    .from(jiraIssues)
    .where(
      and(
        eq(jiraIssues.projectId, projectId),
        lt(jiraIssues.syncedAt, syncStartedAt)
      )
    );

  if (candidates.length === 0) return empty;

  if (seenJiraIds.size === 0) {
    console.warn(
      `[jira-sync] prune skipped for project ${projectId}: Jira returned 0 issues but ${candidates.length} rows exist locally — refusing to wipe the mirror`
    );
    return empty;
  }

  // A failed upsert leaves synced_at stale but the issue is still in Jira —
  // it appears in seenJiraIds and is spared here.
  const stale = candidates.filter((c) => !seenJiraIds.has(c.jiraId));
  if (stale.length === 0) return empty;

  const emails = new Set<string>();
  for (const row of stale) {
    if (row.assigneeEmail) emails.add(row.assigneeEmail);
    for (const e of row.additionalAssigneeEmails ?? []) emails.add(e);
  }

  for (let i = 0; i < stale.length; i += 500) {
    await db.delete(jiraIssues).where(
      inArray(
        jiraIssues.id,
        stale.slice(i, i + 500).map((r) => r.id)
      )
    );
  }

  const prunedKeys = stale.map((r) => r.jiraKey);
  console.log(
    `[jira-sync] pruned ${prunedKeys.length} issue(s) no longer in Jira for project ${projectId}: ${prunedKeys.join(", ")}`
  );
  return { pruned: stale.length, prunedKeys, affectedEmails: [...emails] };
}

/**
 * Full sync of all issues for a project. Paginates through the Jira API in
 * batches of 100 and upserts each issue + its comments + status history.
 */
// The Jira custom field type key for multi-user pickers.
const MULTI_USER_PICKER_TYPE = "com.atlassian.jira.plugin.system.customfieldtypes:multiuserpicker";

type DiscoveredFields = {
  multiAssigneeFieldIds: string[];
  endDateFieldIds: string[];
  startDateFieldIds: string[];
  complexityFieldIds: string[];
  issueOwnerFieldIds: string[];
};

async function discoverProjectFields(
  client: JiraClient,
  projectId: string
): Promise<DiscoveredFields> {
  const fields = await client.fetchFields();

  // Collect every multi-user picker whose name mentions "assignee" — a project
  // may assign people through more than one such field (e.g. EMAMI has both an
  // "Assignee" and a "Multiple Assignee" people field, separate from the native
  // Jira assignee). All of them feed additional_assignee_emails. The name match
  // keeps unrelated pickers like "Approvers" / "Task Collaborator" out.
  const multiAssigneeFieldIds = fields
    .filter(
      (f) =>
        f.custom &&
        f.id !== "assignee" &&
        f.schema?.custom === MULTI_USER_PICKER_TYPE &&
        /assignee/i.test(f.name)
    )
    .map((f) => f.id);

  // Exact-name match avoids picking up "Weekend Date" / "Intended End Date" etc.
  // Also match "Due Date" — some workspaces (e.g. EMAMI) use a custom "Due Date"
  // field (e.g. customfield_10030) instead of Jira's native duedate.
  const endDateFieldIds = fields
    .filter((f) => f.custom && /^(end|due)\s*date$/i.test(f.name.trim()))
    .map((f) => f.id);

  const startDateFieldIds = fields
    .filter((f) => f.custom && /^start\s*date$/i.test(f.name.trim()))
    .map((f) => f.id);

  // Task complexity (1–5) and the "Issue Owner" user-picker — both feed the
  // performance-review rating engine. Exact-name match keeps unrelated fields
  // (e.g. "Complexity Notes", "Issue Owner Team") out.
  const complexityFieldIds = fields
    .filter((f) => f.custom && /^complexity$/i.test(f.name.trim()))
    .map((f) => f.id);

  const issueOwnerFieldIds = fields
    .filter((f) => f.custom && /^issue\s*owner$/i.test(f.name.trim()))
    .map((f) => f.id);

  await db
    .update(jiraProjects)
    .set({
      multiAssigneeFieldIds,
      endDateFieldIds,
      startDateFieldIds,
      complexityFieldIds,
      issueOwnerFieldIds,
    })
    .where(eq(jiraProjects.id, projectId));

  return {
    multiAssigneeFieldIds,
    endDateFieldIds,
    startDateFieldIds,
    complexityFieldIds,
    issueOwnerFieldIds,
  };
}

/**
 * Re-discovers the project's custom field IDs on every sync so renamed,
 * added, or removed Jira fields propagate. On transient API failure we fall
 * back to whatever was cached on the project row (avoids breaking the sync).
 */
export async function resolveProjectFieldConfig(
  client: JiraClient,
  project: {
    id: string;
    multiAssigneeFieldIds: string[] | null;
    endDateFieldIds: string[] | null;
    startDateFieldIds: string[] | null;
    complexityFieldIds: string[] | null;
    issueOwnerFieldIds: string[] | null;
  }
): Promise<{
  multiAssigneeFieldIds: string[];
  issueOwnerFieldIds: string[];
  extraFields: string[];
}> {
  let multiAssigneeFieldIds: string[] | null = project.multiAssigneeFieldIds;
  let endDateFieldIds: string[] | null = project.endDateFieldIds;
  let startDateFieldIds: string[] | null = project.startDateFieldIds;
  let complexityFieldIds: string[] | null = project.complexityFieldIds;
  let issueOwnerFieldIds: string[] | null = project.issueOwnerFieldIds;

  try {
    const discovered = await discoverProjectFields(client, project.id);
    multiAssigneeFieldIds = discovered.multiAssigneeFieldIds;
    endDateFieldIds = discovered.endDateFieldIds;
    startDateFieldIds = discovered.startDateFieldIds;
    complexityFieldIds = discovered.complexityFieldIds;
    issueOwnerFieldIds = discovered.issueOwnerFieldIds;
  } catch (err) {
    // Transient API failure — keep the previously-cached values for this sync.
    console.warn(`[sync] field discovery failed for project ${project.id}:`, err);
  }

  const extraFields: string[] = [];
  if (multiAssigneeFieldIds?.length) extraFields.push(...multiAssigneeFieldIds);
  if (endDateFieldIds?.length) extraFields.push(...endDateFieldIds);
  if (startDateFieldIds?.length) extraFields.push(...startDateFieldIds);
  if (complexityFieldIds?.length) extraFields.push(...complexityFieldIds);
  if (issueOwnerFieldIds?.length) extraFields.push(...issueOwnerFieldIds);

  return {
    multiAssigneeFieldIds: multiAssigneeFieldIds ?? [],
    issueOwnerFieldIds: issueOwnerFieldIds ?? [],
    extraFields,
  };
}

export async function syncProject(projectId: string): Promise<SyncResult> {
  const [project] = await db
    .select()
    .from(jiraProjects)
    .where(eq(jiraProjects.id, projectId))
    .limit(1);

  if (!project) throw new Error(`Project ${projectId} not found`);

  const client = new JiraClient({
    baseUrl: project.jiraBaseUrl,
    email: project.jiraEmail,
    apiToken: decrypt(project.jiraApiToken),
  });

  const { multiAssigneeFieldIds, extraFields } = await resolveProjectFieldConfig(
    client,
    project
  );

  const doneRawStatuses = await getDoneRawStatuses(projectId);
  const accountIdEmailMap = await loadAccountIdEmailMap();

  let synced = 0;
  let errors = 0;
  const errorMessages: string[] = [];
  let nextPageToken: string | undefined = undefined;
  const maxResults = 100;
  const syncStartedAt = new Date();
  const seenJiraIds = new Set<string>();

  for (;;) {
    const result = await client.fetchIssues(
      project.jiraProjectKey,
      nextPageToken,
      maxResults,
      extraFields
    );
    for (const issue of result.issues) seenJiraIds.add(issue.id);

    for (let i = 0; i < result.issues.length; i += SYNC_CONCURRENCY) {
      const chunk = result.issues.slice(i, i + SYNC_CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map((issue) =>
          upsertIssue(
            projectId,
            issue,
            multiAssigneeFieldIds,
            doneRawStatuses,
            accountIdEmailMap
          )
        )
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === "fulfilled") {
          synced++;
        } else {
          errors++;
          const msg =
            r.reason instanceof Error ? r.reason.message : String(r.reason);
          errorMessages.push(`${chunk[j].key}: ${msg}`);
        }
      }
    }

    if (!result.nextPageToken || result.issues.length === 0) break;
    nextPageToken = result.nextPageToken;
  }

  // All pages fetched — safe to reconcile deletions (see helper docs).
  const { pruned } = await pruneIssuesMissingFromJira(
    projectId,
    seenJiraIds,
    syncStartedAt
  );

  await db
    .update(jiraProjects)
    .set({ lastSyncedAt: new Date() })
    .where(eq(jiraProjects.id, projectId));

  return { synced, errors, errorMessages, pruned };
}

// ---------------------------------------------------------------------------
// Issue upsert — insert or update a single issue and its related data
// ---------------------------------------------------------------------------

export type UpsertedIssue = {
  id: string;
  jiraKey: string;
  status: string;
  assigneeName: string | null;
  assigneeEmail: string | null;
  additionalAssigneeEmails: string[];
};

export async function upsertIssue(
  projectId: string,
  raw: JiraIssueRaw,
  multiAssigneeFieldIds?: string[] | null,
  doneRawStatuses?: Set<string>,
  accountIdEmailMap?: Map<string, string>
): Promise<UpsertedIssue> {
  const f = raw.fields;

  // Extract custom fields (everything except the known mapped fields)
  const customFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(f)) {
    if (!KNOWN_ISSUE_FIELDS.has(key) && value !== null && value !== undefined) {
      customFields[key] = value;
    }
  }

  // Extract additional assignee emails from every configured multi-user picker
  // field. Each returns an array of user objects: [{accountId, emailAddress,
  // displayName}]. When emailAddress is hidden by Atlassian privacy settings,
  // fall back to the known accountId → email map built from our
  // users/board_members tables. Emails are de-duplicated across fields.
  const additionalAssigneeEmailSet = new Set<string>();
  for (const fieldId of multiAssigneeFieldIds ?? []) {
    const raw_additional = (f as Record<string, unknown>)[fieldId];
    if (Array.isArray(raw_additional)) {
      for (const u of raw_additional) {
        const obj = u as { emailAddress?: string; accountId?: string };
        const direct = typeof obj.emailAddress === "string" ? obj.emailAddress : null;
        const mapped =
          !direct && obj.accountId ? accountIdEmailMap?.get(obj.accountId) ?? null : null;
        const email = direct ?? mapped;
        if (email) additionalAssigneeEmailSet.add(email);
      }
    }
  }
  const additionalAssigneeEmails = [...additionalAssigneeEmailSet];

  // Same privacy fallback for the primary assignee: if Jira withheld the
  // email, look it up by accountId. This is the single change that makes
  // every downstream email-based filter (timeline, unplanned, pulse,
  // my-tasks, …) keep working for users with restricted profiles.
  const assigneeEmailResolved =
    f.assignee?.emailAddress ??
    (f.assignee?.accountId ? accountIdEmailMap?.get(f.assignee.accountId) ?? null : null);
  const reporterEmailResolved =
    f.reporter?.emailAddress ??
    (f.reporter?.accountId ? accountIdEmailMap?.get(f.reporter.accountId) ?? null : null);

  // Derive the status rollup from the changelog. Bulk sync includes the full
  // changelog (expand=changelog); webhook payloads usually don't, in which case
  // the rollup is maintained incrementally by recordStatusTransition and we
  // must not overwrite it here.
  const hasChangelog = !!raw.changelog?.histories?.length;
  const doneSet = hasChangelog
    ? doneRawStatuses ?? (await getDoneRawStatuses(projectId))
    : null;
  const rollup = doneSet ? computeRollup(raw, doneSet) : null;
  const createdAt = f.created ? new Date(f.created) : new Date();

  // Assignee history is only derivable from the full changelog (bulk sync).
  // Webhook upserts carry no changelog, so we leave the assignee_since rollup
  // and the assignee-change log untouched here — the webhook maintains them
  // incrementally. For a first-time insert without a changelog, fall back to
  // creation time when the issue is currently assigned.
  const assigneeChanges = hasChangelog
    ? extractAssigneeChanges(raw, accountIdEmailMap)
    : null;
  const assigneeSince = hasChangelog
    ? deriveAssigneeSince(raw)
    : f.assignee
      ? createdAt
      : null;

  const issueValues = {
    projectId,
    jiraId: raw.id,
    jiraKey: raw.key,
    summary: f.summary,
    description: f.description ? JSON.stringify(f.description) : null,
    status: f.status.name,
    statusCategory: f.status.statusCategory?.name ?? null,
    issueType: f.issuetype.name,
    priority: f.priority?.name ?? null,
    assigneeAccountId: f.assignee?.accountId ?? null,
    assigneeEmail: assigneeEmailResolved,
    assigneeName: f.assignee?.displayName ?? null,
    reporterAccountId: f.reporter?.accountId ?? null,
    reporterEmail: reporterEmailResolved,
    reporterName: f.reporter?.displayName ?? null,
    labels: f.labels ?? [],
    additionalAssigneeEmails,
    customFields,
    jiraCreatedAt: f.created ? new Date(f.created) : null,
    jiraUpdatedAt: f.updated ? new Date(f.updated) : null,
    completedAt: rollup?.completedAt ?? null,
    currentStatusSince: rollup?.currentStatusSince ?? createdAt,
    assigneeSince,
    timeInStatus: rollup?.timeInStatus ?? {},
    syncedAt: new Date(),
  };

  const updateSet: Record<string, unknown> = {
    summary: issueValues.summary,
    description: issueValues.description,
    status: issueValues.status,
    statusCategory: issueValues.statusCategory,
    issueType: issueValues.issueType,
    priority: issueValues.priority,
    assigneeAccountId: issueValues.assigneeAccountId,
    assigneeEmail: issueValues.assigneeEmail,
    assigneeName: issueValues.assigneeName,
    reporterAccountId: issueValues.reporterAccountId,
    reporterEmail: issueValues.reporterEmail,
    reporterName: issueValues.reporterName,
    labels: issueValues.labels,
    additionalAssigneeEmails: issueValues.additionalAssigneeEmails,
    customFields: issueValues.customFields,
    jiraCreatedAt: issueValues.jiraCreatedAt,
    jiraUpdatedAt: issueValues.jiraUpdatedAt,
    syncedAt: issueValues.syncedAt,
  };
  // Only refresh the rollup (and assignee_since, also changelog-derived) when
  // we computed it from a full changelog.
  if (rollup) {
    updateSet.completedAt = issueValues.completedAt;
    updateSet.currentStatusSince = issueValues.currentStatusSince;
    updateSet.assigneeSince = issueValues.assigneeSince;
    updateSet.timeInStatus = issueValues.timeInStatus;
  }

  // RETURNING lets the webhook caller reuse the persisted row (id, key, status,
  // assignees) instead of issuing follow-up SELECTs against the same row.
  const [row] = await db
    .insert(jiraIssues)
    .values(issueValues)
    .onConflictDoUpdate({
      target: [jiraIssues.projectId, jiraIssues.jiraId],
      set: updateSet,
      // Ordering guard. Jira delivers webhooks concurrently (Vercel runs each
      // POST as a separate parallel invocation) and retries failed ones out of
      // order 5–15 min later. Without this, an older payload landing after a
      // newer one silently clobbers the row — the field-stale bug. Only apply
      // the update when the incoming snapshot is at least as new as what we've
      // stored, so the row converges to the newest payload regardless of which
      // invocation writes last. NULLs (legacy rows or a payload missing
      // `updated`) are allowed through so we never get permanently stuck.
      setWhere: sql`${jiraIssues.jiraUpdatedAt} is null or excluded.jira_updated_at is null or excluded.jira_updated_at >= ${jiraIssues.jiraUpdatedAt}`,
    })
    .returning({
      id: jiraIssues.id,
      jiraKey: jiraIssues.jiraKey,
      status: jiraIssues.status,
      assigneeName: jiraIssues.assigneeName,
      assigneeEmail: jiraIssues.assigneeEmail,
      additionalAssigneeEmails: jiraIssues.additionalAssigneeEmails,
    });

  // Persist the assignee-change event log, idempotent on changelog history id.
  // The accountIds and derived flags are immutable, but the resolved emails/
  // names can improve as the accountId→email map fills in, so we refresh those
  // on conflict (self-healing) rather than skipping.
  if (row && assigneeChanges && assigneeChanges.length > 0) {
    await db
      .insert(jiraAssigneeChanges)
      .values(
        assigneeChanges.map((c) => ({
          issueId: row.id,
          projectId,
          changelogHistoryId: c.changelogHistoryId,
          changedAt: c.changedAt,
          authorAccountId: c.authorAccountId,
          authorEmail: c.authorEmail,
          authorName: c.authorName,
          fromAccountId: c.fromAccountId,
          fromEmail: c.fromEmail,
          fromName: c.fromName,
          toAccountId: c.toAccountId,
          toEmail: c.toEmail,
          toName: c.toName,
          isSelfRemoval: c.isSelfRemoval,
          toKind: c.toKind,
        }))
      )
      .onConflictDoUpdate({
        target: [
          jiraAssigneeChanges.issueId,
          jiraAssigneeChanges.changelogHistoryId,
        ],
        set: {
          authorEmail: sql`excluded.author_email`,
          authorName: sql`excluded.author_name`,
          fromEmail: sql`excluded.from_email`,
          fromName: sql`excluded.from_name`,
          toEmail: sql`excluded.to_email`,
          toName: sql`excluded.to_name`,
        },
      });
  }

  if (row) return row;

  // The ordering guard skipped a stale event, so DO UPDATE matched no row and
  // RETURNING came back empty. Return the current persisted row so callers
  // (cache invalidation, Freshdesk relink) still operate on valid, current
  // data instead of crashing on an undefined row.
  const [current] = await db
    .select({
      id: jiraIssues.id,
      jiraKey: jiraIssues.jiraKey,
      status: jiraIssues.status,
      assigneeName: jiraIssues.assigneeName,
      assigneeEmail: jiraIssues.assigneeEmail,
      additionalAssigneeEmails: jiraIssues.additionalAssigneeEmails,
    })
    .from(jiraIssues)
    .where(and(eq(jiraIssues.projectId, projectId), eq(jiraIssues.jiraId, raw.id)))
    .limit(1);
  return current;
}

// ---------------------------------------------------------------------------
// Status history — build from Jira changelog
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Status transition from webhook — single live transition. Maintains the
// per-issue rollup incrementally (no full changelog available here).
// ---------------------------------------------------------------------------

export async function recordStatusTransition(
  issueId: string,
  fromStatus: string,
  toStatus: string,
  changedAt: Date,
  doneRawStatuses: Set<string>
): Promise<void> {
  const [issue] = await db
    .select({
      currentStatusSince: jiraIssues.currentStatusSince,
      timeInStatus: jiraIssues.timeInStatus,
      completedAt: jiraIssues.completedAt,
    })
    .from(jiraIssues)
    .where(eq(jiraIssues.id, issueId))
    .limit(1);

  if (!issue) return;

  // Ignore stale / out-of-order transitions. If this change predates when the
  // issue entered its current status, a newer transition has already been
  // applied (Jira can deliver status-change webhooks out of order or retry
  // them late). Replaying an older one here would corrupt the rollup with
  // negative durations and a wrong current segment.
  if (issue.currentStatusSince && changedAt < issue.currentStatusSince) return;

  const rollup = applyTransition({
    fromStatus,
    toStatus,
    changedAt,
    prevStatusSince: issue.currentStatusSince,
    prevTimeInStatus: issue.timeInStatus ?? {},
    prevCompletedAt: issue.completedAt,
    doneRawStatuses,
  });

  await db
    .update(jiraIssues)
    .set({
      completedAt: rollup.completedAt,
      currentStatusSince: rollup.currentStatusSince,
      timeInStatus: rollup.timeInStatus,
    })
    .where(eq(jiraIssues.id, issueId));
}

// ---------------------------------------------------------------------------
// Issue deletion
// ---------------------------------------------------------------------------

export async function deleteIssue(
  projectId: string,
  jiraId: string
): Promise<void> {
  await db
    .delete(jiraIssues)
    .where(
      and(eq(jiraIssues.projectId, projectId), eq(jiraIssues.jiraId, jiraId))
    );
}
