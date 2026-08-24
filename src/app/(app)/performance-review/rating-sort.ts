// Pure sort-value selection for the leaderboard's numeric columns —
// extracted from leaderboard-table.tsx so the mapping from a SortKey to the
// row field it reads can be unit-tested without a DOM/React runtime.

import type { ScorecardRow } from "./data";
import { WEIGHTS, SCORE_SCALE } from "@/lib/scorecard/config";

// "score" and "scoreNsaE" both read a full 0-100 composite (finalScore and
// scoreNsaExpected respectively); "m"/"e"/"nsaM"/"nsaE" each read a dedicated
// 0-30 Complex Tasks-only field — see build.ts file header. They're on
// different scales and no longer share a field. "bugQuality"/
// "sprintCommitment"/"complexTasks"/"mttr" read that metric's contribution to
// Score (points × weight × scale, same formula the Contribution cell renders)
// rather than the raw 0-5 points, so sorting matches what's on screen.
export type SortKey =
  | "score"
  | "m"
  | "e"
  | "nsaM"
  | "nsaE"
  | "scoreNsaE"
  | "bugQuality"
  | "sprintCommitment"
  | "complexTasks"
  | "mttr";

// Canonical column order — the single source of truth both the leaderboard
// header/row rendering and the visible-columns feature flag key off, so a
// column can never silently drift out of sync between "sortable" and
// "toggleable via config".
export const ALL_NUMERIC_COLUMNS: SortKey[] = [
  "score",
  "scoreNsaE",
  "m",
  "e",
  "nsaM",
  "nsaE",
  "bugQuality",
  "sprintCommitment",
  "complexTasks",
  "mttr",
];

type SortableRow = Pick<
  ScorecardRow,
  | "finalScore"
  | "markedComplexityScoreAll"
  | "expectedComplexityScoreAll"
  | "markedComplexityScore"
  | "expectedComplexityScore"
  | "scoreNsaExpected"
  | "bugQualityPoints"
  | "sprintCommitmentPoints"
  | "complexTasksPoints"
  | "mttrPoints"
>;

/** Points × weight × scale, matching the Contribution cell's own formula.
 * Unavailable (null) points sort as -1 — below every real 0+ contribution,
 * regardless of sort direction the row lands at the bottom of "has data". */
function contributionValue(points: number | null, weight: number): number {
  return points == null ? -1 : points * weight * SCORE_SCALE;
}

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
    case "bugQuality":
      return contributionValue(row.bugQualityPoints, WEIGHTS.bugQuality);
    case "sprintCommitment":
      return contributionValue(row.sprintCommitmentPoints, WEIGHTS.sprintCommitment);
    case "complexTasks":
      return contributionValue(row.complexTasksPoints, WEIGHTS.complexTasks);
    case "mttr":
      return contributionValue(row.mttrPoints, WEIGHTS.mttr);
  }
}
