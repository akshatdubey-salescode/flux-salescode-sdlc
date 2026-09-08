import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraIssues, jiraProjects } from "@/lib/db/schema";
import { BUG_ISSUE_TYPES } from "@/lib/scorecard/config";
import { rcaSummary, type RcaSummary } from "@/lib/jira/rca";

/**
 * Batched "does this issue have an RCA" lookup — every list surface with an
 * <RcaBadge> calls this once (via the shared client-side batcher in
 * rca-summary-cache.ts) instead of one request per row. Mirrors
 * fetchDelaySummaries' shape (src/lib/delay-tracker/entries.ts).
 *
 * `null` for an issueId means RCA doesn't apply — either the issue isn't a
 * bug-family type, or it wasn't found — so the badge renders nothing rather
 * than a misleading "not given". A real bug with no RCA content resolves to
 * `{ given: false, text: null }`, which the badge DOES render.
 */
export async function fetchRcaSummaries(
  issueIds: string[]
): Promise<Record<string, RcaSummary | null>> {
  if (issueIds.length === 0) return {};

  const rows = await db
    .select({
      id: jiraIssues.id,
      issueType: jiraIssues.issueType,
      customFields: jiraIssues.customFields,
      rcaFieldIds: jiraProjects.rcaFieldIds,
    })
    .from(jiraIssues)
    .innerJoin(jiraProjects, eq(jiraIssues.projectId, jiraProjects.id))
    .where(inArray(jiraIssues.id, issueIds));

  const result: Record<string, RcaSummary | null> = {};
  for (const r of rows) {
    const isBug = BUG_ISSUE_TYPES.has((r.issueType ?? "").trim().toLowerCase());
    result[r.id] = isBug
      ? rcaSummary(r.customFields as Record<string, unknown> | null, r.rcaFieldIds)
      : null;
  }
  return result;
}
