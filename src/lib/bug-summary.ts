// Pure helpers + shared types for the project Bug Summary tab. Kept framework-
// free so they can be unit-tested and reused by the API route and the UI.

export type BugPriorityBucket = "P1" | "P2" | "P3" | "Other";

/** One bug row as returned by the bug-tracker endpoints. */
export type BugRow = {
  id: string;
  jiraKey: string;
  summary: string;
  /** Project this bug belongs to — shown in cross-project (My Bugs / Team) views. */
  projectKey: string;
  projectName: string;
  /** Jira base URL of the bug's project, for building per-row browse links. */
  jiraBaseUrl: string | null;
  status: string;
  statusCategory: string | null;
  priority: string | null;
  priorityBucket: BugPriorityBucket;
  /** Normalized environment label; "—" when unset. */
  environment: string;
  /** Resolved owner: Issue Owner field, else assignee, else "Missing Issue Owner". */
  ownerName: string;
  /** Owner email (attribution key); null when unassigned/unresolved. */
  ownerEmail: string | null;
  /** Primary Jira assignee display name; null when the bug is unassigned. */
  assigneeName: string | null;
  /** Primary assignee email (normalized); null when unassigned. */
  assigneeEmail: string | null;
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

/** Bucket label for bugs with neither an Issue Owner nor an assignee. */
export const MISSING_ISSUE_OWNER = "Missing Issue Owner";
export const ENV_UNSET = "—";

/** Per-developer rollup for the "Developer-wise Bug Count" table. */
export type OwnerSummary = {
  ownerName: string;
  ownerEmail: string | null;
  /** Bugs where this person is the assignee (independent of ownership). */
  assigned: number;
  p1: number;
  p2: number;
  p3: number;
  other: number;
  total: number;
  open: number;
};

/**
 * Aggregate bugs into per-owner P1/P2/P3/Other/Total/Open counts, sorted by
 * total (then open, then name) descending. Shared by the tab UI and the Excel
 * export so both show identical numbers.
 */
export function buildOwnerSummaries(bugs: BugRow[]): OwnerSummary[] {
  // How many bugs each person is the *assignee* of, keyed the same way owners
  // are (email when known, else display name) so the tally lines up with that
  // person's owner row.
  const assignedByKey = new Map<string, number>();
  for (const b of bugs) {
    const aKey = b.assigneeEmail ?? b.assigneeName;
    if (aKey) assignedByKey.set(aKey, (assignedByKey.get(aKey) ?? 0) + 1);
  }

  const map = new Map<string, OwnerSummary>();
  for (const b of bugs) {
    // Group by email when known so the same person isn't split by name casing;
    // fall back to the display name for unassigned/unresolved owners.
    const key = b.ownerEmail ?? b.ownerName;
    let s = map.get(key);
    if (!s) {
      s = {
        ownerName: b.ownerName,
        ownerEmail: b.ownerEmail,
        assigned: assignedByKey.get(key) ?? 0,
        p1: 0,
        p2: 0,
        p3: 0,
        other: 0,
        total: 0,
        open: 0,
      };
      map.set(key, s);
    }
    if (b.priorityBucket === "P1") s.p1++;
    else if (b.priorityBucket === "P2") s.p2++;
    else if (b.priorityBucket === "P3") s.p3++;
    else s.other++;
    s.total++;
    if (b.isOpen) s.open++;
  }
  return [...map.values()].sort(
    (a, b) =>
      b.total - a.total ||
      b.open - a.open ||
      a.ownerName.localeCompare(b.ownerName)
  );
}

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

  // Jira's Environment is free text, so it sometimes holds a whole pasted
  // description (or wiki markup) rather than a label. Anything multi-line or
  // longer than a real environment name isn't a label — treat it as unset so
  // it can't pollute the Env filter chips with a paragraph of text.
  if (trimmed.length > ENV_LABEL_MAX_LEN || /[\r\n]/.test(trimmed)) return ENV_UNSET;
  return trimmed;
}

/** Longest free-text value still treated as an environment label, not prose. */
const ENV_LABEL_MAX_LEN = 30;

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
