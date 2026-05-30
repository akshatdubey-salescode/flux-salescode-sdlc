import type { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { jiraProjects, jiraIssues } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import {
  upsertIssue,
  deleteIssue,
  recordStatusTransition,
  getDoneRawStatuses,
} from "@/lib/jira/sync";
import { loadAccountIdEmailMap } from "@/lib/jira/identity";
import {
  relinkFreshdeskTicket,
  updateLinkedJiraStatus,
  FRESHDESK_CUSTOM_FIELD,
} from "@/lib/freshdesk/sync";
import type { JiraIssueRaw, JiraCommentRaw } from "@/lib/jira/client";
import { revalidateIssueChange } from "@/lib/cache/jira-invalidation";

// Jira webhook payload types
type JiraWebhookEvent = {
  timestamp: number;
  webhookEvent: string;
  issue_event_type_name?: string;
  issue?: JiraIssueRaw;
  comment?: JiraCommentRaw;
  changelog?: {
    items: {
      field: string;
      fromString: string | null;
      toString: string | null;
    }[];
  };
};

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/webhooks/jira/[projectId]">
) {
  const { projectId } = await ctx.params;

  // Validate webhook secret from query param
  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret) {
    return new Response("Missing secret", { status: 401 });
  }

  const [project] = await db
    .select()
    .from(jiraProjects)
    .where(
      and(
        eq(jiraProjects.id, projectId),
        eq(jiraProjects.isActive, true)
      )
    )
    .limit(1);

  if (!project) {
    return new Response("Project not found", { status: 404 });
  }

  if (secret !== decrypt(project.webhookSecret)) {
    return new Response("Invalid secret", { status: 401 });
  }

  let payload: JiraWebhookEvent;
  try {
    payload = (await req.json()) as JiraWebhookEvent;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { webhookEvent, issue, changelog } = payload;
  const issueKey = issue?.key;

  // Accumulate every assignee email touched by this change so we can refresh
  // exactly their caches. We snapshot before mutating (to catch the previous
  // owner on a reassignment or delete) and again after (for the new owner).
  const affectedEmails: string[] = [];
  async function collectAssigneeEmails(jiraId: string) {
    const [row] = await db
      .select({
        assigneeEmail: jiraIssues.assigneeEmail,
        additionalAssigneeEmails: jiraIssues.additionalAssigneeEmails,
      })
      .from(jiraIssues)
      .where(and(eq(jiraIssues.projectId, projectId), eq(jiraIssues.jiraId, jiraId)))
      .limit(1);
    if (!row) return;
    if (row.assigneeEmail) affectedEmails.push(row.assigneeEmail);
    if (row.additionalAssigneeEmails) affectedEmails.push(...row.additionalAssigneeEmails);
  }

  // Loaded lazily per webhook invocation so emails stay populated even when
  // Atlassian withholds emailAddress on the payload (see jira/identity.ts).
  // The map is small and cheap to fetch.
  const accountIdEmailMap = await loadAccountIdEmailMap();

  try {
    switch (webhookEvent) {
      case "jira:issue_created": {
        if (issue) {
          await upsertIssue(
            projectId,
            issue,
            project.multiAssigneeFieldId ?? undefined,
            undefined,
            accountIdEmailMap
          );
          await collectAssigneeEmails(issue.id);

          // If the Freshdesk Ticket ID was already filled in at creation time,
          // link it now — the issue_updated path only fires on field *changes*,
          // so a value present from the start would otherwise never be linked.
          const fdFieldValue = (issue.fields as Record<string, unknown>)[FRESHDESK_CUSTOM_FIELD];
          const fdId = fdFieldValue ? parseInt(String(fdFieldValue), 10) : null;
          if (fdId && !isNaN(fdId)) {
            const [created] = await db
              .select({
                id: jiraIssues.id,
                jiraKey: jiraIssues.jiraKey,
                status: jiraIssues.status,
                assigneeName: jiraIssues.assigneeName,
              })
              .from(jiraIssues)
              .where(and(eq(jiraIssues.projectId, projectId), eq(jiraIssues.jiraId, issue.id)))
              .limit(1);
            if (created) {
              await relinkFreshdeskTicket(created.id, created.jiraKey, created.status, created.assigneeName, fdId, projectId);
            }
          }
        }
        break;
      }

      case "jira:issue_updated": {
        if (issue) {
          await collectAssigneeEmails(issue.id);
          await upsertIssue(
            projectId,
            issue,
            project.multiAssigneeFieldId ?? undefined,
            undefined,
            accountIdEmailMap
          );
          await collectAssigneeEmails(issue.id);

          const [existingIssue] = await db
            .select({
              id: jiraIssues.id,
              jiraKey: jiraIssues.jiraKey,
              status: jiraIssues.status,
              assigneeName: jiraIssues.assigneeName,
            })
            .from(jiraIssues)
            .where(
              and(
                eq(jiraIssues.projectId, projectId),
                eq(jiraIssues.jiraId, issue.id)
              )
            )
            .limit(1);

          if (existingIssue && changelog?.items) {
            const hasStatusChange = changelog.items.some(
              (item) => item.field === "status" && item.fromString && item.toString
            );
            const doneRawStatuses = hasStatusChange
              ? await getDoneRawStatuses(projectId)
              : new Set<string>();
            for (const item of changelog.items) {
              // Assignee change → maintain the assignee_since rollup live so
              // the "assigned ≥24h ago" unplanned filter stays accurate. The
              // per-event log (jira_assignee_changes) is backfilled on the next
              // full sync, which carries the changelog this payload lacks.
              if (item.field === "assignee") {
                await db
                  .update(jiraIssues)
                  .set({
                    assigneeSince: item.toString
                      ? new Date(payload.timestamp)
                      : null,
                  })
                  .where(eq(jiraIssues.id, existingIssue.id));
              }

              // Status transition → update rollup + linked FD ticket
              if (item.field === "status" && item.fromString && item.toString) {
                await recordStatusTransition(
                  existingIssue.id,
                  item.fromString,
                  item.toString,
                  new Date(payload.timestamp),
                  doneRawStatuses
                );
                // Keep the linked Freshdesk ticket's Jira status in sync
                await updateLinkedJiraStatus(existingIssue.id, item.toString);
              }

              // Freshdesk Ticket ID field updated → re-link immediately
              if (item.field === FRESHDESK_CUSTOM_FIELD || item.field === "Freshdesk Ticket ID") {
                const fdId = item.toString ? parseInt(item.toString, 10) : null;
                await relinkFreshdeskTicket(
                  existingIssue.id,
                  existingIssue.jiraKey,
                  existingIssue.status,
                  existingIssue.assigneeName,
                  isNaN(fdId ?? NaN) ? null : fdId
                );
              }
            }
          }
        }
        break;
      }

      case "jira:issue_deleted": {
        if (issue) {
          await collectAssigneeEmails(issue.id);
          await deleteIssue(projectId, issue.id);
        }
        break;
      }

      // Comments are no longer persisted — the issue detail view fetches them
      // from Jira at runtime. We only bust the cache (below) so that view
      // refreshes.
      case "comment_created":
      case "comment_updated":
      case "comment_deleted":
        break;

      default:
        // Unknown event — acknowledge and ignore
        break;
    }
  } catch (err) {
    console.error(`[jira-webhook] error processing ${webhookEvent}:`, err);
    return new Response("Internal error", { status: 500 });
  }

  // Comment events only affect the issue detail view; everything else can
  // change assignment, status, or project rollups, so refresh the issue's
  // assignees, project, and boards. Org-wide aggregates (dashboard, developer
  // list, issues list) refresh on their own cacheLife("minutes") TTL.
  if (
    webhookEvent === "comment_created" ||
    webhookEvent === "comment_updated" ||
    webhookEvent === "comment_deleted"
  ) {
    if (issueKey) revalidateTag(`issue:${issueKey}`, "max");
  } else {
    await revalidateIssueChange({ projectId, emails: affectedEmails, issueKey });
  }

  return new Response("OK", { status: 200 });
}
