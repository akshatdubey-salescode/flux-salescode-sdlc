import { eq } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { jiraIssues, jiraProjects } from "@/lib/db/schema";
import { JiraClient } from "./client";
import { buildStatusSegments } from "./changelog";
import { decrypt } from "@/lib/crypto";

// The per-issue status timeline and comments are no longer persisted. They are
// fetched from Jira at runtime (changelog + comments) and reconstructed here.
// Cached briefly so a hot issue doesn't hammer the Jira API.

export type IssueTimelineStatus = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: Date;
  changedByName: string | null;
  durationSeconds: number | null;
};

export type IssueTimelineComment = {
  id: string;
  authorName: string | null;
  authorEmail: string | null;
  body: string | null;
  jiraCreatedAt: Date | null;
  jiraUpdatedAt: Date | null;
};

export async function getIssueDetail(issueKey: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues", `issue:${issueKey}`);

  const [issue] = await db
    .select()
    .from(jiraIssues)
    .where(eq(jiraIssues.jiraKey, issueKey))
    .limit(1);

  if (!issue) return null;

  const [project] = await db
    .select()
    .from(jiraProjects)
    .where(eq(jiraProjects.id, issue.projectId))
    .limit(1);

  if (!project) return null;

  let statusHistory: IssueTimelineStatus[] = [];
  let comments: IssueTimelineComment[] = [];

  try {
    const client = new JiraClient({
      baseUrl: project.jiraBaseUrl,
      email: project.jiraEmail,
      apiToken: decrypt(project.jiraApiToken),
    });
    const raw = await client.fetchIssue(issue.jiraKey);

    statusHistory = buildStatusSegments(raw).map((s, i) => ({
      id: `${issue.jiraKey}-s${i}`,
      fromStatus: s.fromStatus,
      toStatus: s.toStatus,
      changedAt: s.changedAt,
      changedByName: s.changedByName,
      durationSeconds: s.durationSeconds,
    }));

    comments = (raw.fields.comment?.comments ?? []).map((c, i) => ({
      id: c.id ?? `${issue.jiraKey}-c${i}`,
      authorName: c.author?.displayName ?? null,
      authorEmail: c.author?.emailAddress ?? null,
      body: c.body ? JSON.stringify(c.body) : null,
      jiraCreatedAt: c.created ? new Date(c.created) : null,
      jiraUpdatedAt: c.updated ? new Date(c.updated) : null,
    }));
  } catch (err) {
    // Don't break the page if Jira is unreachable — show issue metadata only.
    console.error(`[issue-detail] runtime fetch failed for ${issueKey}:`, err);
  }

  return { issue, project, statusHistory, comments };
}
