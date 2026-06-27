import { cacheLife, cacheTag } from "next/cache";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { performanceScorecards, jiraProjects, kekaEmployees } from "@/lib/db/schema";
import { PERFORMANCE_SCORECARDS_TAG } from "@/lib/scorecard/cache-tags";
import type { MetricBreakdown } from "@/lib/scorecard/engine";

export type ScorecardRow = {
  rank: number;
  email: string;
  name: string;
  /** Reporting manager's name (from Keka), or null when unmatched/unmanaged. */
  manager: string | null;
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
  /** Deep link to the issue in Jira; absent if the project base URL is unknown. */
  url?: string;
};
export type ScorecardFeatureItem = {
  key: string;
  summary: string;
  complexity: number | null;
  url?: string;
};
export type ScorecardMttrItem = {
  key: string;
  summary: string;
  priority: string | null;
  minutes: number;
  url?: string;
};
export type ScorecardComplexityBucket = {
  label: string;
  count: number;
  weightEach: number;
  totalWeight: number;
};
export type ScorecardMissingActualDateItem = {
  key: string;
  summary: string;
  missingStart: boolean;
  missingEnd: boolean;
  url?: string;
};

export type ScorecardBreakdown = {
  metrics: MetricBreakdown[];
  finalScore: number;
  items?: {
    weightedBugs: ScorecardBugItem[];
    features: ScorecardFeatureItem[];
    mttr?: ScorecardMttrItem[];
    complexity?: ScorecardComplexityBucket[];
    missingActualDates?: ScorecardMissingActualDateItem[];
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
  missingActualDateItems: ScorecardMissingActualDateItem[];
};

// Departments treated as "business team" — excluded from the developer
// leaderboard. Compared after normalizing (lower-cased, non-letters collapsed to
// spaces) so apostrophes / ampersands / spacing don't matter — e.g. "Admin & IT"
// → "admin it", "Founder's Office" → "founder s office".
function normDept(s: string): string {
  return s.toLowerCase().replace(/[^a-z]+/g, " ").trim();
}
const EXCLUDED_DEPARTMENTS = new Set(
  [
    "Sales & Business Development",
    "Projects & Product",
    "Support",
    "Marketing",
    "Human Resources",
    "Finance",
    "Admin & IT",
    "Founder's Office",
  ].map(normDept)
);
/** True for the excluded business-team departments. Unknown department → false
 * (we can't classify them, so they stay in the list). */
function isBusinessTeam(department: string | null | undefined): boolean {
  return department != null && EXCLUDED_DEPARTMENTS.has(normDept(department));
}

/**
 * Per-person department + reporting manager from Keka, keyed by lower-cased
 * email. Drives the leaderboard's Manager column and the business-team filter.
 */
async function kekaMap(): Promise<
  Map<string, { department: string | null; manager: string | null }>
> {
  const rows = await db
    .select({
      email: kekaEmployees.email,
      department: kekaEmployees.department,
      managerName: kekaEmployees.managerName,
    })
    .from(kekaEmployees);
  const map = new Map<string, { department: string | null; manager: string | null }>();
  for (const r of rows) {
    if (!r.email) continue;
    map.set(r.email.toLowerCase(), {
      department: r.department,
      manager: r.managerName?.trim() || null,
    });
  }
  return map;
}

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
  const keka = await kekaMap();

  // Drop business-team people, then rank the remaining developers 1..N.
  return rows
    .filter((r) => !isBusinessTeam(keka.get(r.userEmail.toLowerCase())?.department))
    .map((r, i) => ({
      rank: i + 1,
      email: r.userEmail,
      name: names.get(r.userEmail) ?? r.userEmail,
      manager: keka.get(r.userEmail.toLowerCase())?.manager ?? null,
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

/**
 * Map a Jira project key (e.g. "COCA") to its instance base URL, so per-issue
 * breakdown rows can deep-link to the original Jira. Keyed upper-case.
 */
async function jiraBaseUrlByProjectKey(): Promise<Map<string, string>> {
  const rows = await db
    .select({
      key: jiraProjects.jiraProjectKey,
      baseUrl: jiraProjects.jiraBaseUrl,
    })
    .from(jiraProjects);
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(r.key.toUpperCase(), r.baseUrl.replace(/\/+$/, ""));
  }
  return map;
}

/** `{baseUrl}/browse/{KEY}` for a Jira key, or undefined if the project is unknown. */
function jiraUrl(key: string, baseUrls: Map<string, string>): string | undefined {
  const prefix = key.split("-")[0]?.toUpperCase();
  const base = prefix ? baseUrls.get(prefix) : undefined;
  return base ? `${base}/browse/${key}` : undefined;
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
  const baseUrls = await jiraBaseUrlByProjectKey();
  const breakdown = (r.breakdown as ScorecardBreakdown) ?? {
    metrics: [],
    finalScore: 0,
  };

  const withUrl = <T extends { key: string }>(items: T[]): T[] =>
    items.map((i) => ({ ...i, url: jiraUrl(i.key, baseUrls) }));

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
    weightedBugItems: withUrl(breakdown.items?.weightedBugs ?? []),
    featureItems: withUrl(breakdown.items?.features ?? []),
    mttrItems: withUrl(breakdown.items?.mttr ?? []),
    complexityBuckets: breakdown.items?.complexity ?? [],
    missingActualDateItems: withUrl(breakdown.items?.missingActualDates ?? []),
  };
}
