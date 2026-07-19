import { categoryLabel, pickTopCategory } from "@/lib/delay-tracker/categories";

export type DelayLeader = {
  key: string;
  name: string;
  total: number;
  topCategory: string;
  topCategoryCount: number;
};

/**
 * Buckets rows by `keyCol` (a project id, an email, ...), sums `n` per
 * bucket, and picks each bucket's single most common `category`. Shared by
 * the org-wide (src/app/api/analytics/delays) and per-project
 * (src/app/api/projects/[id]/delays) delay leaderboards so a change to
 * ranking/tie-break semantics only needs to happen once.
 */
export function rankByKey(
  rows: Record<string, unknown>[],
  keyCol: string,
  nameCol: string,
  limit = 10
): DelayLeader[] {
  const byKey = new Map<string, { name: string; total: number; categories: Map<string, number> }>();
  for (const raw of rows) {
    const key = raw[keyCol] as string;
    const name = (raw[nameCol] as string | null) ?? key;
    const category = raw.category as string;
    const n = Number(raw.n);
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { name, total: 0, categories: new Map() };
      byKey.set(key, bucket);
    } else if (bucket.name === key && name !== key) {
      bucket.name = name;
    }
    bucket.total += n;
    bucket.categories.set(category, (bucket.categories.get(category) ?? 0) + n);
  }

  return [...byKey.entries()]
    .map(([key, b]) => {
      const [topCategory, topCategoryCount] = pickTopCategory(b.categories);
      return {
        key,
        name: b.name,
        total: b.total,
        topCategory: categoryLabel(topCategory),
        topCategoryCount,
      };
    })
    .sort(
      (a, b) =>
        b.total - a.total || a.name.localeCompare(b.name) || a.key.localeCompare(b.key)
    )
    .slice(0, limit);
}
