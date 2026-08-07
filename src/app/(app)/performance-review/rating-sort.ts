// Pure sort-value selection for the leaderboard's five rating columns —
// extracted from leaderboard-table.tsx so the mapping from a SortKey to the
// row field it reads can be unit-tested without a DOM/React runtime.

import type { ScorecardRow } from "./data";

// "score" reads finalScore (the full 0-100 composite); "m"/"e"/"nsaM"/"nsaE"
// each read a dedicated 0-30 Complex Tasks-only field — see build.ts file
// header. They're on different scales and no longer share a field.
export type SortKey = "score" | "m" | "e" | "nsaM" | "nsaE";

type SortableRow = Pick<
  ScorecardRow,
  | "finalScore"
  | "markedComplexityScoreAll"
  | "expectedComplexityScoreAll"
  | "markedComplexityScore"
  | "expectedComplexityScore"
>;

export function ratingValueForSortKey(row: SortableRow, key: SortKey): number {
  switch (key) {
    case "score":
      return row.finalScore;
    case "m":
      return row.markedComplexityScoreAll;
    case "e":
      return row.expectedComplexityScoreAll;
    case "nsaM":
      return row.markedComplexityScore;
    case "nsaE":
      return row.expectedComplexityScore;
  }
}
