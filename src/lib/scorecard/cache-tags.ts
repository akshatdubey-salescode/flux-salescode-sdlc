// Cache tag for performance-review scorecard reads. Invalidated (with the
// "max" stale-while-revalidate profile) whenever a quarter is recomputed.
export const PERFORMANCE_SCORECARDS_TAG = "performance-scorecards";
