import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  jiraProjects,
  jiraIssues,
  projectStatusMappings,
} from "@/lib/db/schema";
import { JiraClient, type JiraIssueRaw } from "./client";
import { computeRollup, applyTransition } from "./changelog";
import { decrypt } from "@/lib/crypto";

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

// ---------------------------------------------------------------------------
// Project sync — bulk fetch all issues and upsert into the database
// ---------------------------------------------------------------------------

export type SyncResult = {
  synced: number;
  errors: number;
  errorMessages: string[];
};

/**
 * Full sync of all issues for a project. Paginates through the Jira API in
 * batches of 100 and upserts each issue + its comments + status history.
 */
// The Jira custom field type key for multi-user pickers.
const MULTI_USER_PICKER_TYPE = "com.atlassian.jira.plugin.system.customfieldtypes:multiuserpicker";

type DiscoveredFields = {
  multiAssigneeFieldId: string;
  endDateFieldIds: string[];
  startDateFieldIds: string[];
};

async function discoverProjectFields(
  client: JiraClient,
  projectId: string
): Promise<DiscoveredFields> {
  const fields = await client.fetchFields();

  const multiUserPickerFields = fields.filter(
    (f) =>
      f.custom &&
      f.id !== "assignee" &&
      f.schema?.custom === MULTI_USER_PICKER_TYPE &&
      f.name.toLowerCase() !== "assignee"
  );
  // Prefer a field explicitly named "multiple assignee" (or similar); fall back to first match.
  const multiAssigneeMatch =
    multiUserPickerFields.find((f) =>
      /multiple.{0,4}assignee/i.test(f.name)
    ) ?? multiUserPickerFields[0];
  const multiAssigneeFieldId = multiAssigneeMatch?.id ?? "";

  // Exact-name match avoids picking up "Weekend Date" / "Intended End Date" etc.
  const endDateFieldIds = fields
    .filter((f) => f.custom && /^end\s*date$/i.test(f.name.trim()))
    .map((f) => f.id);

  const startDateFieldIds = fields
    .filter((f) => f.custom && /^start\s*date$/i.test(f.name.trim()))
    .map((f) => f.id);

  await db
    .update(jiraProjects)
    .set({ multiAssigneeFieldId, endDateFieldIds, startDateFieldIds })
    .where(eq(jiraProjects.id, projectId));

  return { multiAssigneeFieldId, endDateFieldIds, startDateFieldIds };
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
    multiAssigneeFieldId: string | null;
    endDateFieldIds: string[] | null;
    startDateFieldIds: string[] | null;
  }
): Promise<{ multiAssigneeFieldId: string; extraFields: string[] }> {
  let multiAssigneeFieldId: string | null = project.multiAssigneeFieldId;
  let endDateFieldIds: string[] | null = project.endDateFieldIds;
  let startDateFieldIds: string[] | null = project.startDateFieldIds;

  try {
    const discovered = await discoverProjectFields(client, project.id);
    multiAssigneeFieldId = discovered.multiAssigneeFieldId;
    endDateFieldIds = discovered.endDateFieldIds;
    startDateFieldIds = discovered.startDateFieldIds;
  } catch (err) {
    // Transient API failure — keep the previously-cached values for this sync.
    console.warn(`[sync] field discovery failed for project ${project.id}:`, err);
  }

  const extraFields: string[] = [];
  if (multiAssigneeFieldId) extraFields.push(multiAssigneeFieldId);
  if (endDateFieldIds?.length) extraFields.push(...endDateFieldIds);
  if (startDateFieldIds?.length) extraFields.push(...startDateFieldIds);

  return { multiAssigneeFieldId: multiAssigneeFieldId ?? "", extraFields };
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

  const { multiAssigneeFieldId, extraFields } = await resolveProjectFieldConfig(
    client,
    project
  );

  const doneRawStatuses = await getDoneRawStatuses(projectId);

  let synced = 0;
  let errors = 0;
  const errorMessages: string[] = [];
  let nextPageToken: string | undefined = undefined;
  const maxResults = 100;

  for (;;) {
    const result = await client.fetchIssues(
      project.jiraProjectKey,
      nextPageToken,
      maxResults,
      extraFields
    );

    for (let i = 0; i < result.issues.length; i += SYNC_CONCURRENCY) {
      const chunk = result.issues.slice(i, i + SYNC_CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map((issue) =>
          upsertIssue(projectId, issue, multiAssigneeFieldId ?? undefined, doneRawStatuses)
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

  await db
    .update(jiraProjects)
    .set({ lastSyncedAt: new Date() })
    .where(eq(jiraProjects.id, projectId));

  return { synced, errors, errorMessages };
}

// ---------------------------------------------------------------------------
// Issue upsert — insert or update a single issue and its related data
// ---------------------------------------------------------------------------

export async function upsertIssue(
  projectId: string,
  raw: JiraIssueRaw,
  multiAssigneeFieldId?: string,
  doneRawStatuses?: Set<string>
): Promise<void> {
  const f = raw.fields;

  // Extract custom fields (everything except the known mapped fields)
  const knownFields = new Set([
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
  const customFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(f)) {
    if (!knownFields.has(key) && value !== null && value !== undefined) {
      customFields[key] = value;
    }
  }

  // Extract additional assignee emails from the multi-user picker field.
  // The field returns an array of user objects: [{accountId, emailAddress, displayName}]
  const additionalAssigneeEmails: string[] = [];
  if (multiAssigneeFieldId) {
    const raw_additional = (f as Record<string, unknown>)[multiAssigneeFieldId];
    if (Array.isArray(raw_additional)) {
      for (const u of raw_additional) {
        const email = (u as { emailAddress?: string })?.emailAddress;
        if (email && typeof email === "string") {
          additionalAssigneeEmails.push(email);
        }
      }
    }
  }

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
    assigneeEmail: f.assignee?.emailAddress ?? null,
    assigneeName: f.assignee?.displayName ?? null,
    reporterAccountId: f.reporter?.accountId ?? null,
    reporterEmail: f.reporter?.emailAddress ?? null,
    reporterName: f.reporter?.displayName ?? null,
    labels: f.labels ?? [],
    additionalAssigneeEmails,
    customFields,
    jiraCreatedAt: f.created ? new Date(f.created) : null,
    jiraUpdatedAt: f.updated ? new Date(f.updated) : null,
    completedAt: rollup?.completedAt ?? null,
    currentStatusSince: rollup?.currentStatusSince ?? createdAt,
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
  // Only refresh the rollup when we computed it from a full changelog.
  if (rollup) {
    updateSet.completedAt = issueValues.completedAt;
    updateSet.currentStatusSince = issueValues.currentStatusSince;
    updateSet.timeInStatus = issueValues.timeInStatus;
  }

  await db
    .insert(jiraIssues)
    .values(issueValues)
    .onConflictDoUpdate({
      target: [jiraIssues.projectId, jiraIssues.jiraId],
      set: updateSet,
    });
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
