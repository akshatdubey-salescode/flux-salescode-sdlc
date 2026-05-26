import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  jiraProjects,
  jiraIssues,
  jiraStatusHistory,
  jiraComments,
} from "@/lib/db/schema";
import { JiraClient, type JiraIssueRaw, type JiraCommentRaw } from "./client";
import { decrypt } from "@/lib/crypto";

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
  projectId: string,
  current: {
    multiAssigneeFieldId: string | null;
    endDateFieldIds: string[] | null;
    startDateFieldIds: string[] | null;
  }
): Promise<DiscoveredFields> {
  const fields = await client.fetchFields();

  let multiAssigneeFieldId = current.multiAssigneeFieldId;
  if (multiAssigneeFieldId === null) {
    const match = fields.find(
      (f) =>
        f.custom &&
        f.id !== "assignee" &&
        f.schema?.custom === MULTI_USER_PICKER_TYPE
    );
    multiAssigneeFieldId = match?.id ?? "";
  }

  // Exact-name match avoids picking up "Weekend Date" / "Intended End Date" etc.
  let endDateFieldIds = current.endDateFieldIds;
  if (endDateFieldIds === null) {
    endDateFieldIds = fields
      .filter((f) => f.custom && /^end\s*date$/i.test(f.name.trim()))
      .map((f) => f.id);
  }

  let startDateFieldIds = current.startDateFieldIds;
  if (startDateFieldIds === null) {
    startDateFieldIds = fields
      .filter((f) => f.custom && /^start\s*date$/i.test(f.name.trim()))
      .map((f) => f.id);
  }

  await db
    .update(jiraProjects)
    .set({ multiAssigneeFieldId, endDateFieldIds, startDateFieldIds })
    .where(eq(jiraProjects.id, projectId));

  return { multiAssigneeFieldId, endDateFieldIds, startDateFieldIds };
}

/**
 * Ensures the project's custom field IDs are discovered, returning the lists
 * ready to be passed to `fetchIssues` / `upsertIssue`. Discovery runs only
 * when any of the three columns is null; cached values are reused otherwise.
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
  let { multiAssigneeFieldId, endDateFieldIds, startDateFieldIds } = project;
  if (
    multiAssigneeFieldId === null ||
    endDateFieldIds === null ||
    startDateFieldIds === null
  ) {
    try {
      const discovered = await discoverProjectFields(client, project.id, {
        multiAssigneeFieldId,
        endDateFieldIds,
        startDateFieldIds,
      });
      multiAssigneeFieldId = discovered.multiAssigneeFieldId;
      endDateFieldIds = discovered.endDateFieldIds;
      startDateFieldIds = discovered.startDateFieldIds;
    } catch (err) {
      // Don't poison the cache on transient API failures; leave nulls so the
      // next sync re-attempts discovery. Sync continues without the extras.
      console.warn(`[sync] field discovery failed for project ${project.id}:`, err);
    }
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
        chunk.map((issue) => upsertIssue(projectId, issue, multiAssigneeFieldId ?? undefined))
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
  multiAssigneeFieldId?: string
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
    syncedAt: new Date(),
  };

  const [issue] = await db
    .insert(jiraIssues)
    .values(issueValues)
    .onConflictDoUpdate({
      target: [jiraIssues.projectId, jiraIssues.jiraId],
      set: {
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
      },
    })
    .returning();

  // Sync status history from changelog
  if (raw.changelog?.histories) {
    await upsertStatusHistory(issue.id, raw);
  }

  // Sync comments — single batch insert instead of N sequential round-trips
  const rawComments = f.comment?.comments ?? [];
  if (rawComments.length > 0) {
    const syncedAt = new Date();
    await db
      .insert(jiraComments)
      .values(
        rawComments.map((raw) => ({
          issueId: issue.id,
          jiraCommentId: raw.id,
          authorAccountId: raw.author?.accountId ?? null,
          authorEmail: raw.author?.emailAddress ?? null,
          authorName: raw.author?.displayName ?? null,
          body: raw.body ? JSON.stringify(raw.body) : null,
          jiraCreatedAt: raw.created ? new Date(raw.created) : null,
          jiraUpdatedAt: raw.updated ? new Date(raw.updated) : null,
          syncedAt,
        }))
      )
      .onConflictDoUpdate({
        target: [jiraComments.issueId, jiraComments.jiraCommentId],
        set: {
          authorEmail: sql`excluded.author_email`,
          authorName: sql`excluded.author_name`,
          body: sql`excluded.body`,
          jiraUpdatedAt: sql`excluded.jira_updated_at`,
          syncedAt: sql`excluded.synced_at`,
        },
      });
  }
}

// ---------------------------------------------------------------------------
// Status history — build from Jira changelog
// ---------------------------------------------------------------------------

async function upsertStatusHistory(
  issueId: string,
  raw: JiraIssueRaw
): Promise<void> {
  const histories = raw.changelog?.histories ?? [];

  // Collect all status-field changes sorted by time ascending
  type StatusChange = {
    fromStatus: string | null;
    toStatus: string;
    changedAt: Date;
    changedByName: string;
    changedByEmail: string | null;
  };

  const changes: StatusChange[] = [];

  const sorted = [...histories].sort(
    (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
  );

  for (const history of sorted) {
    for (const item of history.items) {
      if (item.field === "status") {
        changes.push({
          fromStatus: item.fromString,
          toStatus: item.toString ?? raw.fields.status.name,
          changedAt: new Date(history.created),
          changedByName: history.author.displayName,
          changedByEmail: history.author.emailAddress ?? null,
        });
      }
    }
  }

  if (changes.length === 0) return;

  // Accumulate all rows then batch-insert — replaces N sequential round-trips
  const historyRows: (typeof jiraStatusHistory.$inferInsert)[] = [];

  // Reconstruct the initial status row from the first transition's fromStatus
  const firstChange = changes[0];
  if (firstChange.fromStatus) {
    const createdAt = raw.fields.created
      ? new Date(raw.fields.created)
      : new Date();
    historyRows.push({
      issueId,
      fromStatus: null,
      toStatus: firstChange.fromStatus,
      changedAt: createdAt,
      changedByName: null,
      changedByEmail: null,
      durationSeconds: Math.floor(
        (firstChange.changedAt.getTime() - createdAt.getTime()) / 1000
      ),
    });
  }

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const next = changes[i + 1];
    historyRows.push({
      issueId,
      fromStatus: change.fromStatus,
      toStatus: change.toStatus,
      changedAt: change.changedAt,
      changedByName: change.changedByName,
      changedByEmail: change.changedByEmail,
      durationSeconds: next
        ? Math.floor(
            (next.changedAt.getTime() - change.changedAt.getTime()) / 1000
          )
        : null,
    });
  }

  await db
    .insert(jiraStatusHistory)
    .values(historyRows)
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Status transition from webhook — single transition, not full changelog
// ---------------------------------------------------------------------------

export async function recordStatusTransition(
  issueId: string,
  fromStatus: string,
  toStatus: string,
  changedAt: Date,
  changedByName: string | null,
  changedByEmail: string | null
): Promise<void> {
  // Update the previous row's durationSeconds now that we know when it ended
  const [prev] = await db
    .select()
    .from(jiraStatusHistory)
    .where(eq(jiraStatusHistory.issueId, issueId))
    .orderBy(desc(jiraStatusHistory.changedAt))
    .limit(1);

  if (prev && prev.durationSeconds === null) {
    const durationSeconds = Math.floor(
      (changedAt.getTime() - prev.changedAt.getTime()) / 1000
    );
    await db
      .update(jiraStatusHistory)
      .set({ durationSeconds })
      .where(eq(jiraStatusHistory.id, prev.id));
  }

  await db
    .insert(jiraStatusHistory)
    .values({
      issueId,
      fromStatus,
      toStatus,
      changedAt,
      changedByName,
      changedByEmail,
      durationSeconds: null,
    })
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Comment upsert
// ---------------------------------------------------------------------------

export async function upsertComment(
  issueId: string,
  raw: JiraCommentRaw
): Promise<void> {
  await db
    .insert(jiraComments)
    .values({
      issueId,
      jiraCommentId: raw.id,
      authorAccountId: raw.author?.accountId ?? null,
      authorEmail: raw.author?.emailAddress ?? null,
      authorName: raw.author?.displayName ?? null,
      body: raw.body ? JSON.stringify(raw.body) : null,
      jiraCreatedAt: raw.created ? new Date(raw.created) : null,
      jiraUpdatedAt: raw.updated ? new Date(raw.updated) : null,
      syncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [jiraComments.issueId, jiraComments.jiraCommentId],
      set: {
        authorEmail: raw.author?.emailAddress ?? null,
        authorName: raw.author?.displayName ?? null,
        body: raw.body ? JSON.stringify(raw.body) : null,
        jiraUpdatedAt: raw.updated ? new Date(raw.updated) : null,
        syncedAt: new Date(),
      },
    });
}

// ---------------------------------------------------------------------------
// Issue deletion (cascades to comments + status history)
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

// ---------------------------------------------------------------------------
// Comment deletion
// ---------------------------------------------------------------------------

export async function deleteComment(
  issueId: string,
  jiraCommentId: string
): Promise<void> {
  await db
    .delete(jiraComments)
    .where(
      and(
        eq(jiraComments.issueId, issueId),
        eq(jiraComments.jiraCommentId, jiraCommentId)
      )
    );
}
