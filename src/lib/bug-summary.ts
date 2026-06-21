// Pure helpers + shared types for the project Bug Summary tab. Kept framework-
// free so they can be unit-tested and reused by the API route and the UI.

export type BugPriorityBucket = "P1" | "P2" | "P3" | "Other";

/** One bug row as returned by /api/projects/[id]/bugs. */
export type BugRow = {
  id: string;
  jiraKey: string;
  summary: string;
  status: string;
  statusCategory: string | null;
  priority: string | null;
  priorityBucket: BugPriorityBucket;
  /** Normalized environment label; "—" when unset. */
  environment: string;
  /** Resolved owner: Issue Owner field, else assignee, else "Unassigned". */
  ownerName: string;
  /** Owner email (attribution key); null when unassigned/unresolved. */
  ownerEmail: string | null;
  /** Not yet resolved (status category is not Done). */
  isOpen: boolean;
  /**
   * Status excludes this bug from "real" counts — "Not a bug" / "Can't
   * Reproduce" — matching the performance engine's BUG_INVALID_STATUSES.
   */
  isInvalid: boolean;
  jiraCreatedAt: string | null;
  jiraUpdatedAt: string | null;
};

export type BugSummaryResponse = {
  bugs: BugRow[];
  jiraBaseUrl: string;
};

export const UNASSIGNED_OWNER = "Unassigned";
export const ENV_UNSET = "—";

/**
 * Collapse Jira's free-text environment field to a canonical label. People
 * type the same environment many ways ("prod" / "Production" / "PRD"), so we
 * match on substrings of the lower-cased value rather than exact equality.
 * Unrecognized values are returned trimmed-as-is; null/blank → "—".
 */
export function normalizeEnvironment(raw: unknown): string {
  // The system field is plain text, but tolerate a Jira option object too.
  let value: string | null = null;
  if (typeof raw === "string") value = raw;
  else if (raw && typeof raw === "object" && "value" in raw) {
    const v = (raw as { value: unknown }).value;
    if (typeof v === "string") value = v;
  }

  const trimmed = (value ?? "").trim();
  if (!trimmed) return ENV_UNSET;

  const lower = trimmed.toLowerCase();
  if (/\bprod|production|\bprd\b|\blive\b/.test(lower)) return "Prod";
  if (/\buat\b/.test(lower)) return "UAT";
  if (/\bdemo\b/.test(lower)) return "Demo";
  return trimmed;
}

/**
 * Resolve an issue's environment label from its synced custom_fields. Prefers
 * the discovered "Environment" dropdown (option object {value}); falls back to
 * Jira's free-text system `environment` field. Returns "—" when neither is set.
 */
export function resolveEnvironment(
  cf: Record<string, unknown> | null | undefined,
  environmentFieldIds: string[] | null
): string {
  if (cf) {
    for (const id of environmentFieldIds ?? []) {
      const norm = normalizeEnvironment(cf[id]);
      if (norm !== ENV_UNSET) return norm;
    }
    const sys = normalizeEnvironment(cf["environment"]);
    if (sys !== ENV_UNSET) return sys;
  }
  return ENV_UNSET;
}

/**
 * Map a Jira priority name to a P1/P2/P3/Other bucket for the developer-wise
 * count table. Handles both numeric Jira priorities (P1..P4) and named ones
 * (Highest/High/Medium/Low), normalized to lower-case. P0/Blocker/Critical
 * fold into the most-severe bucket (P1).
 */
export function priorityBucket(priority: string | null): BugPriorityBucket {
  const p = (priority ?? "").trim().toLowerCase();
  if (["p0", "p1", "highest", "blocker", "critical"].includes(p)) return "P1";
  if (["p2", "high", "major"].includes(p)) return "P2";
  if (["p3", "medium", "moderate"].includes(p)) return "P3";
  return "Other";
}
