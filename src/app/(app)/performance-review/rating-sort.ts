// Pure sort-value selection for the leaderboard's five rating columns —
// extracted from leaderboard-table.tsx so the mapping from a SortKey to the
// row field it reads can be unit-tested without a DOM/React runtime.

import type { ScorecardRow } from "./data";

// "score" and "mar" intentionally read the same field (finalScore) — see
// build.ts file header: Complex. (Mar) is the identical formula and value as
// Score, just labeled for the 2x2 rating grid. Kept as separate keys so each
// column's header highlights independently of the other's, even though they
// always sort identically.
export type SortKey = "score" | "mar" | "exp" | "nsaMar" | "nsaExp";

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
    case "mar":
      return row.finalScore;
    case "exp":
      return row.expectedComplexityScoreAll;
    case "nsaMar":
      return row.markedComplexityScore;
    case "nsaExp":
      return row.expectedComplexityScore;
  }
}
