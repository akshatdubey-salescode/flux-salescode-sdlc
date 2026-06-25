// Shared start/due date extraction for synced Jira issues.
// Falls back through well-known field keys, then any project-specific
// custom fields discovered during sync (e.g. "End date" plugins).

// NOTE: customfield_10014 used to live here labelled "start date (epic /
// alternate)", but on this Jira site it is the Epic Link field and holds an
// issue key (e.g. "CT-197"), not a date. It is intentionally omitted. The
// per-project "Start Date" field (e.g. customfield_11448) is discovered by
// name during sync and supplied via the `discovered` argument below.
export const DEFAULT_START_DATE_KEYS = [
  "customfield_10015", // start date (sprint)
  "startdate",
  "start_date",
] as const;

export const DEFAULT_DUE_DATE_KEYS = [
  "duedate", // Jira-native due date
  "due_date",
  "customfield_10021", // due date (alternate)
  "end_date",
  "customfield_11449", // end date (Applicate)
] as const;

// A picked field value is only a usable date if it is (or begins with) an
// ISO calendar date. Several candidate keys collide with non-date fields in
// some Jira instances — e.g. customfield_10014 is the Epic Link in this site
// and holds an issue key like "CT-197" — so the raw value must be validated
// before it is treated as a planned date.
function toIsoDate(val: unknown): string | null {
  if (typeof val !== "string" || !val) return null;
  const candidate = val.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const d = new Date(candidate + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return candidate;
}

function pickDate(
  cf: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const iso = toIsoDate(cf[key]);
    if (iso) return iso;
  }
  return null;
}

export function extractStartDate(
  cf: Record<string, unknown>,
  discovered: string[] | null = null
): string | null {
  const keys = discovered?.length
    ? [...DEFAULT_START_DATE_KEYS, ...discovered]
    : DEFAULT_START_DATE_KEYS;
  return pickDate(cf, keys);
}

export function extractDueDate(
  cf: Record<string, unknown>,
  discovered: string[] | null = null
): string | null {
  const keys = discovered?.length
    ? [...DEFAULT_DUE_DATE_KEYS, ...discovered]
    : DEFAULT_DUE_DATE_KEYS;
  return pickDate(cf, keys);
}

// "Actual start" / "Actual end" are datetime fields (not just calendar dates),
// so unlike the planned-date extractors above they return a full Date. They
// are the preferred source for the performance-review developer work-window;
// the changelog-derived dev_started_at / dev_completed_at are the fallback.
function toDateTime(val: unknown): Date | null {
  if (typeof val !== "string" || !val) return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pickDateTime(
  cf: Record<string, unknown>,
  discovered: string[] | null
): Date | null {
  if (!discovered?.length) return null;
  for (const key of discovered) {
    const d = toDateTime(cf[key]);
    if (d) return d;
  }
  return null;
}

export function extractActualStart(
  cf: Record<string, unknown>,
  discovered: string[] | null = null
): Date | null {
  return pickDateTime(cf, discovered);
}

export function extractActualEnd(
  cf: Record<string, unknown>,
  discovered: string[] | null = null
): Date | null {
  return pickDateTime(cf, discovered);
}
