// Pure sort-value selection for the leaderboard's five rating columns —
// extracted from leaderboard-table.tsx so the mapping from a SortKey to the
// row field it reads can be unit-tested without a DOM/React runtime.

import type { ScorecardRow } from "./data";

// "score" and "m" intentionally read the same field (finalScore) — see
// build.ts file header: Complex. (M) is the identical formula and value as
// Score, just labeled for the 2x2 rating grid. Kept as separate keys so each
// column's header highlights independently of the other's, even though they
// always sort identically.
export type SortKey = "score" | "m" | "e" | "nsaM" | "nsaE";

type SortableRow = Pick<
  ScorecardRow,
  | "finalScore"
  | "expectedComplexityScoreAll"
  | "markedComplexityScore"
  | "expectedComplexityScore"
>;

export function ratingValueForSortKey(row: SortableRow, key: SortKey): number {
  switch (key) {
    case "score":
    case "m":
      return row.finalScore;
    case "e":
      return row.expectedComplexityScoreAll;
    case "nsaM":
      return row.markedComplexityScore;
    case "nsaE":
      return row.expectedComplexityScore;
  }
}
