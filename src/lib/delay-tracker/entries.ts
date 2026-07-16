import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/** Matches the codebase's YYYY-MM-DD date-input convention (delayDate is a plain `date` column, not a Jira-field date). */
export function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
}

export function isValidUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

export function parseOptionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return value.trim() || null;
}

export type DelayLogEntry = {
  id: string;
  category: string;
  delayDate: string;
  responsibleEmail: string | null;
  responsibleName: string | null;
  note: string | null;
  loggedBy: string;
  loggedByName: string | null;
  createdAt: string;
  updatedAt: string;
  linkedProjectId: string | null;
  linkedProjectName: string | null;
  linkedIssueId: string | null;
  linkedJiraKey: string | null;
  linkedSummary: string | null;
};

/** Shared row→DelayLogEntry mapping for every query that joins delay_logs to its linked issue/project. */
export function mapDelayLogRow(r: Record<string, unknown>): DelayLogEntry {
  return {
    id: r.id as string,
    category: r.category as string,
    delayDate: r.delay_date as string,
    responsibleEmail: (r.responsible_email as string | null) ?? null,
    responsibleName: (r.responsible_name as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    loggedBy: r.logged_by as string,
    loggedByName: (r.logged_by_name as string | null) ?? null,
    // db.execute() returns timestamps as raw strings, not Date objects (same
    // convention as every other raw-SQL route in this app) — pass through as-is.
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    linkedProjectId: (r.linked_project_id as string | null) ?? null,
    linkedProjectName: (r.linked_project_name as string | null) ?? null,
    linkedIssueId: (r.linked_issue_id as string | null) ?? null,
    linkedJiraKey: (r.linked_jira_key as string | null) ?? null,
    linkedSummary: (r.linked_summary as string | null) ?? null,
  };
}

const DELAY_LOG_SELECT = sql`
  SELECT
    dl.id, dl.category, dl.delay_date, dl.responsible_email, dl.responsible_name,
    dl.note, dl.logged_by, dl.logged_by_name, dl.created_at, dl.updated_at,
    dl.linked_project_id, dl.linked_issue_id,
    li.jira_key AS linked_jira_key, li.summary AS linked_summary,
    lp.name AS linked_project_name
  FROM delay_logs dl
  LEFT JOIN jira_issues li ON li.id = dl.linked_issue_id
  LEFT JOIN jira_projects lp ON lp.id = dl.linked_project_id
`;

/** Full history for one issue, newest first — used by the issue-detail popup. */
export async function fetchDelayLogHistory(issueId: string): Promise<DelayLogEntry[]> {
  const res = await db.execute(sql`
    ${DELAY_LOG_SELECT}
    WHERE dl.issue_id = ${issueId}
    ORDER BY dl.delay_date DESC, dl.created_at DESC
  `);
  return (res.rows as Record<string, unknown>[]).map(mapDelayLogRow);
}

/**
 * One entry, fully joined. Used right after an insert/update so the response
 * includes linkedJiraKey/linkedSummary/linkedProjectName immediately — the
 * raw `.returning()` row from drizzle only has the linked *ids*, which made a
 * freshly created/edited "Other Project" entry render without its Linked:
 * line until the popup was closed and reopened (a fresh GET re-joins it).
 */
export async function fetchDelayLogEntry(id: string): Promise<DelayLogEntry | null> {
  const res = await db.execute(sql`
    ${DELAY_LOG_SELECT}
    WHERE dl.id = ${id}
    LIMIT 1
  `);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ? mapDelayLogRow(row) : null;
}
