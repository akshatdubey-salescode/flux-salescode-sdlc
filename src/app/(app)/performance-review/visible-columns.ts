// Which numeric leaderboard columns are visible — a DATABASE config
// (feature_flags.performanceReviewVisibleColumns), not a hardcoded set, so a
// manager can hide columns they don't care about without a deploy. Fetched
// fresh on every page load (see getVisibleColumns) — never cached, so an
// edit takes effect on the very next request, not after some cache TTL
// lapses. This flag only controls which columns show; column *order* always
// stays canonical (ALL_NUMERIC_COLUMNS' order), regardless of what order the
// flag's array happens to list keys in.

import { FEATURE_FLAGS, getFlagUncached } from "@/lib/feature-flags";
import defaultFlags from "@/lib/defaultFeatureFlags.json";
import { ALL_NUMERIC_COLUMNS, type SortKey } from "./rating-sort";

// Fallback only — used when the DB flag is missing or malformed, never as a
// silent substitute for a real fetch. The single source of truth for the
// *default* value is defaultFeatureFlags.json; the live value always comes
// from getVisibleColumns().
export const DEFAULT_VISIBLE_COLUMNS: SortKey[] =
  defaultFlags.performanceReviewVisibleColumns as SortKey[];

/**
 * Validates an arbitrary value (whatever's actually stored in the DB — a
 * superuser can type anything into the feature-flags editor) as a usable
 * column-key list. Returns null on anything malformed so the caller can fall
 * back rather than render a broken table over a typo.
 */
export function parseVisibleColumns(raw: unknown): SortKey[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const known = new Set<string>(ALL_NUMERIC_COLUMNS);
  for (const entry of raw) {
    if (typeof entry !== "string" || !known.has(entry)) return null;
  }
  return raw as SortKey[];
}

/**
 * The live set of visible numeric columns, in canonical order — fetched
 * straight from feature_flags on every call via getFlagUncached (no cache
 * layer at all), so a superuser editing the flag takes effect on the very
 * next page load. Falls back to DEFAULT_VISIBLE_COLUMNS if the flag is
 * absent or its stored value doesn't parse as a valid column-key list.
 */
export async function getVisibleColumns(): Promise<SortKey[]> {
  const raw = await getFlagUncached(FEATURE_FLAGS.PERFORMANCE_REVIEW_VISIBLE_COLUMNS);
  const parsed = parseVisibleColumns(raw) ?? DEFAULT_VISIBLE_COLUMNS;
  const visible = new Set(parsed);
  return ALL_NUMERIC_COLUMNS.filter((key) => visible.has(key));
}
