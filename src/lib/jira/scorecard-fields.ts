// Extraction helpers for the Jira custom fields that feed the performance-
// review rating engine. These fields are not mapped onto dedicated columns —
// they live in jira_issues.custom_fields (JSONB) and are
// read at scoring time using the per-project field IDs discovered during sync
// (jira_projects.complexity_field_ids / issue_owner_field_ids).

type CustomFields = Record<string, unknown>;

/**
 * Read the raw task complexity from the first populated discovered field.
 * Handles a plain number, a numeric string, and a Jira select-option object
 * ({ value: "3" }). Returns null when no complexity is set.
 *
 * The raw (un-clamped) value is returned so callers can apply the engine's
 * rules: clamp 1–5 for weighting, but use raw ≥ 3 for the "complex" test.
 */
export function extractComplexity(
  cf: CustomFields | null | undefined,
  discovered: string[] | null
): number | null {
  if (!cf || !discovered?.length) return null;
  for (const key of discovered) {
    const val = cf[key];
    const n = coerceNumber(val);
    if (n !== null) return n;
  }
  return null;
}

/**
 * Resolve the "Issue Owner" user-picker field to an email. Mirrors the
 * assignee privacy fallback used in sync.ts: prefer the embedded email, else
 * map the accountId via the shared accountId→email directory. Handles both
 * single-user (object) and multi-user (array, first entry) pickers. Returns a
 * normalized (trimmed, lower-cased) email or null.
 */
export function extractIssueOwnerEmail(
  cf: CustomFields | null | undefined,
  discovered: string[] | null,
  accountIdEmailMap?: Map<string, string> | null
): string | null {
  if (!cf || !discovered?.length) return null;
  for (const key of discovered) {
    const raw = cf[key];
    const user = Array.isArray(raw) ? raw[0] : raw;
    if (!user || typeof user !== "object") continue;
    const obj = user as { emailAddress?: string; accountId?: string };
    const direct = typeof obj.emailAddress === "string" ? obj.emailAddress : null;
    const mapped =
      !direct && obj.accountId ? accountIdEmailMap?.get(obj.accountId) ?? null : null;
    const email = direct ?? mapped;
    if (email) return normalizeEmail(email);
  }
  return null;
}

/**
 * Original estimate in seconds (Jira's timeoriginalestimate). Returns null
 * when missing. The AI-tasks metric treats a missing estimate as
 * non-qualifying, so null must be distinguishable from 0.
 */
export function extractOriginalEstimateSeconds(
  cf: CustomFields | null | undefined
): number | null {
  if (!cf) return null;
  return coerceNumber(cf["timeoriginalestimate"]);
}

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}

function coerceNumber(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const n = Number(val.trim());
    return Number.isFinite(n) ? n : null;
  }
  // Jira select-option object, e.g. { value: "3", id: "..." }.
  if (val && typeof val === "object" && "value" in val) {
    return coerceNumber((val as { value: unknown }).value);
  }
  return null;
}
