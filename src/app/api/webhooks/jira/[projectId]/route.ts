import type { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects, jiraIssues } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import {
  upsertIssue,
  upsertComment,
  deleteIssue,
  deleteComment,
  recordStatusTransition,
} from "@/lib/jira/sync";
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

  const { webhookEvent, issue, comment, changelog } = payload;

  try {
    switch (webhookEvent) {
      case "jira:issue_created": {
        if (issue) await upsertIssue(projectId, issue);
        break;
      }

      case "jira:issue_updated": {
        if (issue) {
          await upsertIssue(projectId, issue);

          // If the changelog includes a status transition, record it explicitly
          // so we accurately track time-in-status without waiting for a full sync.
          if (changelog?.items) {
            const statusItem = changelog.items.find(
              (i) => i.field === "status"
            );
            if (statusItem && statusItem.fromString && statusItem.toString) {
              const [existingIssue] = await db
                .select({ id: jiraIssues.id })
                .from(jiraIssues)
                .where(
                  and(
                    eq(jiraIssues.projectId, projectId),
                    eq(jiraIssues.jiraId, issue.id)
                  )
                )
                .limit(1);

              if (existingIssue) {
                await recordStatusTransition(
                  existingIssue.id,
                  statusItem.fromString,
                  statusItem.toString,
                  new Date(payload.timestamp),
                  null,
                  null
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

      case "comment_created":
      case "comment_updated": {
        if (comment && issue) {
          const [existingIssue] = await db
            .select({ id: jiraIssues.id })
            .from(jiraIssues)
            .where(
              and(
                eq(jiraIssues.projectId, projectId),
                eq(jiraIssues.jiraId, issue.id)
              )
            )
            .limit(1);

          if (existingIssue) {
            await upsertComment(existingIssue.id, comment);
          }
        }
        break;
      }

      case "comment_deleted": {
        if (comment && issue) {
          const [existingIssue] = await db
            .select({ id: jiraIssues.id })
            .from(jiraIssues)
            .where(
              and(
                eq(jiraIssues.projectId, projectId),
                eq(jiraIssues.jiraId, issue.id)
              )
            )
            .limit(1);

          if (existingIssue) {
            await deleteComment(existingIssue.id, comment.id);
          }
        }
        break;
      }

      default:
        // Unknown event — acknowledge and ignore
        break;
    }
  } catch (err) {
    console.error(`[jira-webhook] error processing ${webhookEvent}:`, err);
    return new Response("Internal error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
