import { revalidateTag } from "next/cache";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { observerBoardMembers } from "@/lib/db/schema";

/**
 * Targeted cache invalidation for a single Jira issue change.
 *
 * Invalidates only the caches whose data actually depends on this issue:
 * each affected assignee's my-tasks + observer-developer views, the issue's
 * project, the issue detail, and any observer boards that include an affected
 * assignee as a member. Org-wide aggregates (dashboard, developer typeahead,
 * global issues list) deliberately rely on their cacheLife("minutes") TTL
 * rather than per-issue invalidation — at 30k+ issues, invalidating those on
 * every webhook would recompute heavy aggregates constantly for no freshness
 * benefit beyond ~1 minute.
 *
 * `emails` should be the union of the issue's old and new assignee emails
 * (primary + additional), so a reassignment refreshes both the previous and
 * the new owner.
 */
export async function revalidateIssueChange({
  projectId,
  emails,
  issueKey,
}: {
  projectId: string;
  emails: string[];
  issueKey?: string;
}) {
  revalidateTag(`project:${projectId}`, "max");
  if (issueKey) revalidateTag(`issue:${issueKey}`, "max");

  const uniqueEmails = [...new Set(emails.filter(Boolean))];
  if (uniqueEmails.length === 0) return;

  for (const email of uniqueEmails) {
    revalidateTag(`my-tasks:${email}`, "max");
    revalidateTag(`developer:${email}`, "max");
  }

  const boards = await db
    .selectDistinct({ boardId: observerBoardMembers.boardId })
    .from(observerBoardMembers)
    .where(inArray(observerBoardMembers.email, uniqueEmails));

  for (const { boardId } of boards) {
    revalidateTag(`board:${boardId}`, "max");
  }
}
