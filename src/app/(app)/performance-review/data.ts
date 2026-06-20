import { cacheLife, cacheTag } from "next/cache";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { performanceScorecards } from "@/lib/db/schema";
import { PERFORMANCE_SCORECARDS_TAG } from "@/lib/scorecard/cache-tags";
import type { MetricBreakdown } from "@/lib/scorecard/engine";

export type ScorecardRow = {
  rank: number;
  email: string;
  name: string;
  finalScore: number;
  bugQualityPoints: number | null;
  mttrPoints: number | null;
  sprintCommitmentPoints: number | null;
  complexTasksPoints: number | null;
  underestimatedTasksPoints: number | null;
  complexTasksCount: number;
  computedAt: string | null;
};

export type ScorecardBugItem = {
  key: string;
  summary: string;
  priority: string | null;
  weight: number;
};
export type ScorecardFeatureItem = {
  key: string;
  summary: string;
  complexity: number | null;
};
export type ScorecardMttrItem = {
  key: string;
  summary: string;
  priority: string | null;
  minutes: number;
};
export type ScorecardComplexityBucket = {
  label: string;
  count: number;
  weightEach: number;
  totalWeight: number;
};

export type ScorecardBreakdown = {
  metrics: MetricBreakdown[];
  finalScore: number;
  items?: {
    weightedBugs: ScorecardBugItem[];
    features: ScorecardFeatureItem[];
    mttr?: ScorecardMttrItem[];
    complexity?: ScorecardComplexityBucket[];
  };
};

export type ScorecardDetail = {
  email: string;
  name: string;
  finalScore: number;
  computedAt: string | null;
  weightedBugs: number;
  featureCount: number;
  mttrMinutes: number | null;
  sprintCommitmentNotDelayed: number;
  sprintCommitmentTotal: number;
  complexTasksCount: number;
  underestimatedTasksCount: number;
  breakdown: ScorecardBreakdown;
  weightedBugItems: ScorecardBugItem[];
  featureItems: ScorecardFeatureItem[];
  mttrItems: ScorecardMttrItem[];
  complexityBuckets: ScorecardComplexityBucket[];
};

/**
 * Display names keyed by lower-cased email, sourced from the best-known Jira
 * assignee display name. Used so the leaderboard shows a person's name rather
 * than just their email.
 */
async function nameMap(): Promise<Map<string, string>> {
  const res = await db.execute(sql`
    SELECT lower(assignee_email) AS email, max(assignee_name) AS name
    FROM jira_issues
    WHERE assignee_email IS NOT NULL
    GROUP BY lower(assignee_email)
  `);
  const map = new Map<string, string>();
  for (const r of res.rows as { email: string; name: string | null }[]) {
    if (r.name) map.set(r.email, r.name);
  }
  return map;
}

/** Leaderboard for a quarter, ranked by final score (desc). */
export async function fetchScorecards(quarterKey: string): Promise<ScorecardRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(PERFORMANCE_SCORECARDS_TAG);

  // Scalar columns only — the breakdown JSONB (which holds the per-issue item
  // lists) can be large, and the leaderboard doesn't need it.
  const rows = await db
    .select({
      userEmail: performanceScorecards.userEmail,
      finalScore: performanceScorecards.finalScore,
      bugQualityPoints: performanceScorecards.bugQualityPoints,
      mttrPoints: performanceScorecards.mttrPoints,
      sprintCommitmentPoints: performanceScorecards.sprintCommitmentPoints,
      complexTasksPoints: performanceScorecards.complexTasksPoints,
      underestimatedTasksPoints: performanceScorecards.underestimatedTasksPoints,
      complexTasksCount: performanceScorecards.complexTasksCount,
      computedAt: performanceScorecards.computedAt,
    })
    .from(performanceScorecards)
    .where(eq(performanceScorecards.quarterKey, quarterKey))
    .orderBy(desc(performanceScorecards.finalScore));

  const names = await nameMap();

  return rows.map((r, i) => ({
    rank: i + 1,
    email: r.userEmail,
    name: names.get(r.userEmail) ?? r.userEmail,
    finalScore: r.finalScore,
    bugQualityPoints: r.bugQualityPoints,
    mttrPoints: r.mttrPoints,
    sprintCommitmentPoints: r.sprintCommitmentPoints,
    complexTasksPoints: r.complexTasksPoints,
    underestimatedTasksPoints: r.underestimatedTasksPoints,
    complexTasksCount: r.complexTasksCount,
    computedAt: r.computedAt ? r.computedAt.toISOString() : null,
  }));
}

/** Full breakdown for one developer in a quarter (drill-down). */
export async function fetchScorecardDetail(
  email: string,
  quarterKey: string
): Promise<ScorecardDetail | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(PERFORMANCE_SCORECARDS_TAG);

  const [r] = await db
    .select()
    .from(performanceScorecards)
    .where(
      sql`${performanceScorecards.userEmail} = ${email.toLowerCase()} AND ${performanceScorecards.quarterKey} = ${quarterKey}`
    )
    .limit(1);

  if (!r) return null;

  const names = await nameMap();
  const breakdown = (r.breakdown as ScorecardBreakdown) ?? {
    metrics: [],
    finalScore: 0,
  };

  return {
    email: r.userEmail,
    name: names.get(r.userEmail) ?? r.userEmail,
    finalScore: r.finalScore,
    computedAt: r.computedAt ? r.computedAt.toISOString() : null,
    weightedBugs: r.weightedBugs,
    featureCount: r.featureCount,
    mttrMinutes: r.mttrMinutes,
    sprintCommitmentNotDelayed: r.sprintCommitmentNotDelayed,
    sprintCommitmentTotal: r.sprintCommitmentTotal,
    complexTasksCount: r.complexTasksCount,
    underestimatedTasksCount: r.underestimatedTasksCount,
    breakdown,
    weightedBugItems: breakdown.items?.weightedBugs ?? [],
    featureItems: breakdown.items?.features ?? [],
    mttrItems: breakdown.items?.mttr ?? [],
    complexityBuckets: breakdown.items?.complexity ?? [],
  };
}
