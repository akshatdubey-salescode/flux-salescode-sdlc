// Pure sort-value selection for the leaderboard's five rating columns —
// extracted from leaderboard-table.tsx so the mapping from a SortKey to the
// row field it reads can be unit-tested without a DOM/React runtime.

import type { ScorecardRow } from "./data";

// "score" and "scoreNsaE" both read a full 0-100 composite (finalScore and
// scoreNsaExpected respectively); "m"/"e"/"nsaM"/"nsaE" each read a dedicated
// 0-30 Complex Tasks-only field — see build.ts file header. They're on
// different scales and no longer share a field.
export type SortKey = "score" | "m" | "e" | "nsaM" | "nsaE" | "scoreNsaE";

type SortableRow = Pick<
  ScorecardRow,
  | "finalScore"
  | "markedComplexityScoreAll"
  | "expectedComplexityScoreAll"
  | "markedComplexityScore"
  | "expectedComplexityScore"
  | "scoreNsaExpected"
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
    case "scoreNsaE":
      return row.scoreNsaExpected;
  }
}
