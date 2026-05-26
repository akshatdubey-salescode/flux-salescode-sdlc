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
import {
  relinkFreshdeskTicket,
  updateLinkedJiraStatus,
  FRESHDESK_CUSTOM_FIELD,
} from "@/lib/freshdesk/sync";
import type { JiraIssueRaw, JiraCommentRaw } from "@/lib/jira/client";

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

  try {
    switch (webhookEvent) {
      case "jira:issue_created": {
        if (issue) await upsertIssue(projectId, issue, project.multiAssigneeFieldId ?? undefined);
        break;
      }

      case "jira:issue_updated": {
        if (issue) {
          await upsertIssue(projectId, issue, project.multiAssigneeFieldId ?? undefined);

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
        if (issue) await deleteIssue(projectId, issue.id);
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

  revalidateTag("jira-issues", "max");
  revalidateTag(`project:${projectId}`, "max");

  return new Response("OK", { status: 200 });
}
