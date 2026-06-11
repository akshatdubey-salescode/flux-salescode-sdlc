// Shared start/due date extraction for synced Jira issues.
// Falls back through well-known field keys, then any project-specific
// custom fields discovered during sync (e.g. "End date" plugins).

export const DEFAULT_START_DATE_KEYS = [
  "customfield_10015", // start date (sprint)
  "customfield_10014", // start date (epic / alternate)
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

function pickDate(
  cf: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const val = cf[key];
    if (typeof val === "string" && val) return val.slice(0, 10);
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
