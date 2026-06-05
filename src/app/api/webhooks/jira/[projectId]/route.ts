import type { NextRequest } from "next/server";
import { eq, and, ne } from "drizzle-orm";
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

  // Instrumentation (console-only, no added cost). Every non-200 path below
  // logs through `fail` so dropped deliveries stop being invisible — the
  // previous handler only logged on the 500 path, which is why genuine drops
  // (401/404/400) left no trace. The Jira-assigned delivery id is stable across
  // retries, so it ties a logged failure to its later retry in Jira's logs.
  const startedAt = performance.now();
  const webhookId = req.headers.get("x-atlassian-webhook-identifier") ?? "unknown";
  const elapsed = () => Math.round(performance.now() - startedAt);
  const fail = (status: number, reason: string) => {
    console.warn(
      `[jira-webhook] ${status} ${reason} project=${projectId} id=${webhookId} ms=${elapsed()}`
    );
    return new Response(reason, { status });
  };

  // Validate webhook secret from query param
  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret) {
    return fail(401, "Missing secret");
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
    return fail(404, "Project not found");
  }

  if (secret !== decrypt(project.webhookSecret)) {
    return fail(401, "Invalid secret");
  }

  let payload: JiraWebhookEvent;
  try {
    payload = (await req.json()) as JiraWebhookEvent;
  } catch {
    return fail(400, "Invalid JSON");
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

  // Resolved lazily and only for events that actually use it (issue
  // created/updated). Comment and delete events skip the lookup entirely.
  // identity.ts memoizes the result for ~60s across warm-instance invocations,
  // so the per-webhook cost is amortized to near zero.
  let accountIdEmailMapPromise: Promise<Map<string, string>> | null = null;
  const getAccountIdEmailMap = () =>
    (accountIdEmailMapPromise ??= loadAccountIdEmailMap());

  try {
    switch (webhookEvent) {
      case "jira:issue_created": {
        if (issue) {
          const created = await upsertIssue(
            projectId,
            issue,
            project.multiAssigneeFieldIds,
            undefined,
            await getAccountIdEmailMap()
          );
          // New assignees come from the upsert's RETURNING — no follow-up SELECT.
          if (created.assigneeEmail) affectedEmails.push(created.assigneeEmail);
          affectedEmails.push(...created.additionalAssigneeEmails);

          // If the Freshdesk Ticket ID was already filled in at creation time,
          // link it now — the issue_updated path only fires on field *changes*,
          // so a value present from the start would otherwise never be linked.
          const fdFieldValue = (issue.fields as Record<string, unknown>)[FRESHDESK_CUSTOM_FIELD];
          const fdId = fdFieldValue ? parseInt(String(fdFieldValue), 10) : null;
          if (fdId !== null && fdId > 0) {
            await relinkFreshdeskTicket(created.id, created.jiraKey, created.status, created.assigneeName, fdId, projectId);
          }

          // When an issue moves between Jira projects, Jira fires issue_created
          // on the destination webhook but does NOT fire issue_deleted on the
          // source webhook (the JQL filter evaluates post-move, so the source
          // no longer matches). Delete any stale rows with the same jira_id in
          // other projects to avoid zombie entries.
          const zombies = await db
            .delete(jiraIssues)
            .where(and(eq(jiraIssues.jiraId, issue.id), ne(jiraIssues.projectId, projectId)))
            .returning({
              projectId: jiraIssues.projectId,
              jiraKey: jiraIssues.jiraKey,
              assigneeEmail: jiraIssues.assigneeEmail,
              additionalAssigneeEmails: jiraIssues.additionalAssigneeEmails,
            });
          for (const zombie of zombies) {
            const zombieEmails: string[] = [];
            if (zombie.assigneeEmail) zombieEmails.push(zombie.assigneeEmail);
            zombieEmails.push(...(zombie.additionalAssigneeEmails ?? []));
            await revalidateIssueChange({
              projectId: zombie.projectId,
              emails: zombieEmails,
              issueKey: zombie.jiraKey,
            });
          }
        }
        break;
      }

      case "jira:issue_updated": {
        if (issue) {
          // Capture the previous owners before the upsert (catches the prior
          // assignee on a reassignment).
          await collectAssigneeEmails(issue.id);
          // The upsert's RETURNING gives us both the new owners and the row
          // (id/key/status/assignee) the rest of this branch needs — replacing
          // a second collectAssigneeEmails SELECT and a separate row SELECT.
          const existingIssue = await upsertIssue(
            projectId,
            issue,
            project.multiAssigneeFieldIds,
            undefined,
            await getAccountIdEmailMap()
          );
          if (existingIssue.assigneeEmail) affectedEmails.push(existingIssue.assigneeEmail);
          affectedEmails.push(...existingIssue.additionalAssigneeEmails);

          if (changelog?.items) {
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

              // Freshdesk Ticket ID field updated → re-link immediately.
              // Check both the display name ("Freshdesk Ticket ID") and the
              // raw fieldId ("customfield_11699") because Jira Cloud webhook
              // payloads include a fieldId property not captured in our type.
              const fieldId = (item as Record<string, unknown>).fieldId as string | undefined;
              const isFreshdeskField =
                fieldId === FRESHDESK_CUSTOM_FIELD ||
                item.field === "Freshdesk Ticket ID";
              if (isFreshdeskField) {
                const fdId = item.toString ? parseInt(item.toString, 10) : null;
                await relinkFreshdeskTicket(
                  existingIssue.id,
                  existingIssue.jiraKey,
                  existingIssue.status,
                  existingIssue.assigneeName,
                  fdId !== null && !isNaN(fdId) ? fdId : null,
                  projectId
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
    console.error(
      `[jira-webhook] 500 error processing ${webhookEvent} project=${projectId} id=${webhookId} key=${issueKey ?? "?"} ms=${elapsed()}:`,
      err
    );
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

  // Jira marks a delivery failed at a 20s response timeout (and may retry it
  // out of order). Warn when we get close so the timeout theory is observable
  // without paying for per-request success logging.
  const ms = elapsed();
  if (ms > 10_000) {
    console.warn(
      `[jira-webhook] slow ${ms}ms ${webhookEvent} project=${projectId} id=${webhookId} key=${issueKey ?? "?"}`
    );
  }

  return new Response("OK", { status: 200 });
}
