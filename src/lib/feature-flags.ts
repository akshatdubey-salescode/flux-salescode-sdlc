import { cacheLife, cacheTag } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { featureFlags } from "@/lib/db/schema";
import type { FeatureFlag } from "@/lib/db/schema";
import defaultFlags from "./defaultFeatureFlags.json";

// ---------------------------------------------------------------------------
// Types — derived from the JSON file so the schema is the single source of
// truth for which flags exist and what their defaults are.
// ---------------------------------------------------------------------------

export type FlagKey = keyof typeof defaultFlags;

// Typed map of flag name → DB key. TypeScript enforces that every value is a
// known FlagKey — a typo here is a compile error.
export const FEATURE_FLAGS = {
  REQUIREMENT_BUILDER: "enableRequirementBuilder",
  COMPLEXITY_LOC_RANGES: "complexityLocRanges",
  PERFORMANCE_REVIEW_VISIBLE_COLUMNS: "performanceReviewVisibleColumns",
} as const satisfies Record<string, FlagKey>;

// ---------------------------------------------------------------------------
// Internal DB fetch — cached, never exported directly.
// ---------------------------------------------------------------------------

async function fetchAllFlags(): Promise<FeatureFlag[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("feature-flags");

  return db.select().from(featureFlags);
}

// ---------------------------------------------------------------------------
// Public getters
// ---------------------------------------------------------------------------

/**
 * Returns the effective value for a flag: DB row if present, otherwise the
 * default from defaultFeatureFlags.json. Never returns null for known flags.
 */
export async function getFlag(key: FlagKey): Promise<unknown> {
  const rows = await fetchAllFlags();
  const row = rows.find((r) => r.key === key);
  return row ? row.value : defaultFlags[key];
}

/**
 * Returns true only when the flag value is the boolean literal `true`.
 * Stored values of 1, "true", or any other truthy JSON are treated as off,
 * keeping the semantics explicit and safe.
 */
export async function isEnabled(key: FlagKey): Promise<boolean> {
  return (await getFlag(key)) === true;
}

/**
 * Same as getFlag, but reads straight from the DB every call — no "use
 * cache", no cacheTag, no staleness window at all. For config that must
 * reflect an edit immediately the next time it's read (e.g. a value fetched
 * fresh on every scoring run), where an hours-long cache would silently
 * serve a stale number. Costs a query per call by design; only use this for
 * flags read at a low, deliberate frequency (once per job run, not per
 * request).
 */
export async function getFlagUncached(key: FlagKey): Promise<unknown> {
  const [row] = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.key, key))
    .limit(1);
  return row ? row.value : defaultFlags[key];
}

// ---------------------------------------------------------------------------
// Admin-only list — returns all known flags merged with DB overrides.
// Rows not yet in the DB appear with their default value.
// Only import this in superuser/admin pages.
// ---------------------------------------------------------------------------

export type ResolvedFlag = {
  key: FlagKey;
  value: unknown;
  description: string | null;
  updatedAt: Date;
  isDefault: boolean;
};

export async function listFlags(): Promise<ResolvedFlag[]> {
  const rows = await fetchAllFlags();
  const dbMap = new Map(rows.map((r) => [r.key, r]));

  return (Object.keys(defaultFlags) as FlagKey[]).map((key) => {
    const row = dbMap.get(key);
    if (row) {
      return {
        key: key as FlagKey,
        value: row.value,
        description: row.description,
        updatedAt: row.updatedAt,
        isDefault: false,
      };
    }
    return {
      key,
      value: defaultFlags[key],
      description: null,
      updatedAt: new Date(0),
      isDefault: true,
    };
  });
}
