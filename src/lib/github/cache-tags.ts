// Cache tags for GitHub-derived data. Revalidated (with the "max" profile)
// whenever a sync writes fresh stats, so the lines-of-code dashboard reflects
// new data without waiting for the cacheLife TTL to lapse.

export const GITHUB_STATS_TAG = "github-stats";

// Static tag alongside each reader's own per-user cacheTag (e.g.
// `github-my-activity:${email}`) — a per-user tag alone can't be bulk
// revalidated after a sync without knowing every email in advance, so a
// sync revalidates this shared tag instead.
export const MY_GITHUB_ACTIVITY_TAG = "github-my-activity";

export function githubStatsTag(): string {
  return GITHUB_STATS_TAG;
}
