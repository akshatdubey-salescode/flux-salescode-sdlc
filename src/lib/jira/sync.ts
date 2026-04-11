import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  jiraProjects,
  jiraIssues,
  jiraStatusHistory,
  jiraComments,
} from "@/lib/db/schema";
import { JiraClient, type JiraIssueRaw, type JiraCommentRaw } from "./client";
import { decrypt } from "@/lib/crypto";

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

  let synced = 0;
  let errors = 0;
  const errorMessages: string[] = [];
  let startAt = 0;
  const maxResults = 100;

  for (;;) {
    const result = await client.fetchIssues(
      project.jiraProjectKey,
      startAt,
      maxResults
    );

    for (const issue of result.issues) {
      try {
        await upsertIssue(projectId, issue);
        synced++;
      } catch (err) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        errorMessages.push(`${issue.key}: ${msg}`);
      }
    }

    startAt += result.issues.length;
    if (startAt >= result.total || result.issues.length === 0) break;
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
  raw: JiraIssueRaw
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

  // Sync comments
  for (const comment of f.comment?.comments ?? []) {
    await upsertComment(issue.id, comment);
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

  // If we have transitions, reconstruct the initial status row
  // The first transition's fromStatus is the issue's original status.
  const firstChange = changes[0];
  if (firstChange.fromStatus) {
    // Insert the initial state row (issue was created in this status)
    await db
      .insert(jiraStatusHistory)
      .values({
        issueId,
        fromStatus: null,
        toStatus: firstChange.fromStatus,
        changedAt: raw.fields.created ? new Date(raw.fields.created) : new Date(),
        changedByName: null,
        changedByEmail: null,
        durationSeconds: Math.floor(
          (firstChange.changedAt.getTime() -
            (raw.fields.created ? new Date(raw.fields.created).getTime() : 0)) /
            1000
        ),
      })
      .onConflictDoNothing();
  }

  // Insert each status change with duration = gap to next change
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const next = changes[i + 1];
    const durationSeconds = next
      ? Math.floor(
          (next.changedAt.getTime() - change.changedAt.getTime()) / 1000
        )
      : null; // current status, duration unknown

    await db
      .insert(jiraStatusHistory)
      .values({
        issueId,
        fromStatus: change.fromStatus,
        toStatus: change.toStatus,
        changedAt: change.changedAt,
        changedByName: change.changedByName,
        changedByEmail: change.changedByEmail,
        durationSeconds,
      })
      .onConflictDoNothing();
  }
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
