// Cache tags for GitHub-derived data. Revalidated (with the "max" profile)
// whenever a sync writes fresh stats, so the lines-of-code dashboard reflects
// new data without waiting for the cacheLife TTL to lapse.

export const GITHUB_STATS_TAG = "github-stats";

export function githubStatsTag(): string {
  return GITHUB_STATS_TAG;
}
