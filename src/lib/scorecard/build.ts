// Loads quarter-scoped Jira data, derives the per-user scoring inputs (rating
// doc §5), runs the pure engine (engine.ts), and persists one
// performance_scorecards row per developer. Overwrites the quarter on each run.

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraIssues, jiraProjects, performanceScorecards } from "@/lib/db/schema";
import { loadAccountIdEmailMap } from "@/lib/jira/identity";
import { extractDueDate } from "@/lib/jira/dates";
import {
  extractComplexity,
  extractIssueOwnerEmail,
  extractOriginalEstimateSeconds,
  normalizeEmail,
} from "@/lib/jira/scorecard-fields";
import {
  BUG_INVALID_STATUSES,
  BUG_ISSUE_TYPES,
  COMPLEX_THRESHOLD,
  COMPLEXITY_WEIGHTS,
  DEFAULT_COMPLEXITY_WEIGHT,
  DEFAULT_PRIORITY_WEIGHT,
  PRIORITY_WEIGHTS,
  P1_PRIORITIES,
  P2_PRIORITIES,
  AI_TASK_MAX_ESTIMATE_HOURS,
  normalizeStatus,
} from "./config";
import { computeScorecard, type ScorecardInputs } from "./engine";
import { quarterFromKey } from "./quarter";

// Issue-level detail kept for the drill-down's "weighted bugs" / "feature
// tasks" tables, so the breakdown shows exactly which issues drove the numbers.
type BugItem = {
  key: string;
  summary: string;
  priority: string | null;
  weight: number;
};
type FeatureItem = { key: string; summary: string; complexity: number | null };
type MttrItem = {
  key: string;
  summary: string;
  priority: string | null;
  minutes: number;
};
type ComplexityBucket = {
  label: string;
  count: number;
  weightEach: number;
  totalWeight: number;
};

type Acc = {
  features: number;
  weightedBugs: number;
  ownedBugKeys: Set<string>;
  mttrSamples: number[];
  sprintNotDelayed: number;
  sprintTotal: number;
  complexWeightedTotal: number;
  complexTotalTasks: number;
  aiTaskCount: number;
  totalComplex: number;
  bugItems: BugItem[];
  featureItems: FeatureItem[];
  mttrItems: MttrItem[];
  // Count of tasks per complexity bucket ("1".."5" or "unset"), for the
  // Complex-tasks distribution table.
  complexityCounts: Map<string, number>;
};

function emptyAcc(): Acc {
  return {
    features: 0,
    weightedBugs: 0,
    ownedBugKeys: new Set(),
    mttrSamples: [],
    sprintNotDelayed: 0,
    sprintTotal: 0,
    complexWeightedTotal: 0,
    complexTotalTasks: 0,
    aiTaskCount: 0,
    totalComplex: 0,
    bugItems: [],
    featureItems: [],
    mttrItems: [],
    complexityCounts: new Map(),
  };
}

function buildComplexityBuckets(counts: Map<string, number>): ComplexityBucket[] {
  const buckets: ComplexityBucket[] = [];
  for (let level = 1; level <= 5; level++) {
    const count = counts.get(String(level)) ?? 0;
    if (count === 0) continue;
    const weightEach = COMPLEXITY_WEIGHTS[level] ?? DEFAULT_COMPLEXITY_WEIGHT;
    buckets.push({ label: `C${level}`, count, weightEach, totalWeight: count * weightEach });
  }
  const unset = counts.get("unset") ?? 0;
  if (unset > 0) {
    buckets.push({
      label: "Unset (→ C1)",
      count: unset,
      weightEach: DEFAULT_COMPLEXITY_WEIGHT,
      totalWeight: unset * DEFAULT_COMPLEXITY_WEIGHT,
    });
  }
  return buckets;
}

function isP1OrP2(priority: string | null): boolean {
  if (!priority) return false;
  const p = priority.trim().toLowerCase();
  return P1_PRIORITIES.has(p) || P2_PRIORITIES.has(p);
}

function priorityWeight(priority: string | null): number {
  if (!priority) return DEFAULT_PRIORITY_WEIGHT;
  return PRIORITY_WEIGHTS[priority.trim().toLowerCase()] ?? DEFAULT_PRIORITY_WEIGHT;
}

function complexityWeight(rawComplexity: number | null): number {
  const capped = Math.min(5, Math.max(1, Math.round(rawComplexity ?? 1)));
  return COMPLEXITY_WEIGHTS[capped] ?? DEFAULT_COMPLEXITY_WEIGHT;
}

export type BuildResult = { quarterKey: string; developersScored: number };

/**
 * Recompute every developer's scorecard for the given quarter key (e.g.
 * "FY2026-Q1") and persist it, replacing any prior run for that quarter.
 */
export async function buildScorecards(quarterKey: string): Promise<BuildResult> {
  const quarter = quarterFromKey(quarterKey);
  if (!quarter) throw new Error(`Invalid quarter key: ${quarterKey}`);

  const accountIdEmailMap = await loadAccountIdEmailMap();

  // Issues both raised and completed within the quarter, with their project's
  // discovered custom-field IDs (for complexity / issue-owner / due-date
  // extraction). Requiring created-in-quarter keeps the scorecard's counts in
  // step with the Bug Board, which scopes by created date.
  const rows = await db
    .select({
      jiraKey: jiraIssues.jiraKey,
      summary: jiraIssues.summary,
      issueType: jiraIssues.issueType,
      status: jiraIssues.status,
      priority: jiraIssues.priority,
      assigneeEmail: jiraIssues.assigneeEmail,
      reporterEmail: jiraIssues.reporterEmail,
      customFields: jiraIssues.customFields,
      createdAt: jiraIssues.jiraCreatedAt,
      completedAt: jiraIssues.completedAt,
      complexityFieldIds: jiraProjects.complexityFieldIds,
      issueOwnerFieldIds: jiraProjects.issueOwnerFieldIds,
      endDateFieldIds: jiraProjects.endDateFieldIds,
    })
    .from(jiraIssues)
    .innerJoin(jiraProjects, eq(jiraIssues.projectId, jiraProjects.id))
    .where(
      and(
        sql`${jiraIssues.completedAt} is not null`,
        sql`${jiraIssues.completedAt}::date >= ${quarter.start}::date`,
        sql`${jiraIssues.completedAt}::date <= ${quarter.end}::date`,
        // Only count work that was also raised within the quarter, so the
        // scorecard's bug/task counts line up with the Bug Board (which scopes
        // by created date). Drops cross-quarter carryover finished this quarter.
        sql`${jiraIssues.jiraCreatedAt} is not null`,
        sql`${jiraIssues.jiraCreatedAt}::date >= ${quarter.start}::date`,
        sql`${jiraIssues.jiraCreatedAt}::date <= ${quarter.end}::date`
      )
    );

  const accs = new Map<string, Acc>();
  const getAcc = (email: string): Acc => {
    let a = accs.get(email);
    if (!a) {
      a = emptyAcc();
      accs.set(email, a);
    }
    return a;
  };

  // Partition so all bug ownership is known before tasks compute feature count.
  const bugs: typeof rows = [];
  const tasks: typeof rows = [];
  for (const r of rows) {
    if (BUG_ISSUE_TYPES.has((r.issueType ?? "").trim().toLowerCase())) bugs.push(r);
    else tasks.push(r);
  }

  // Pass 1 — bugs: weighted bugs → owner; MTTR sample → assignee.
  for (const b of bugs) {
    // not a bug / couldn't reproduce → excluded from all scoring
    if (BUG_INVALID_STATUSES.has(normalizeStatus(b.status))) continue;

    const assignee = normalizeEmail(b.assigneeEmail);
    const owner =
      extractIssueOwnerEmail(b.customFields, b.issueOwnerFieldIds, accountIdEmailMap) ??
      assignee;

    if (owner) {
      const a = getAcc(owner);
      const weight = priorityWeight(b.priority);
      a.weightedBugs += weight;
      a.ownedBugKeys.add(b.jiraKey);
      a.bugItems.push({
        key: b.jiraKey,
        summary: b.summary,
        priority: b.priority,
        weight,
      });
    }

    // MTTR follows the same owner attribution as weighted bugs, so a bug is
    // wholly the owner's (Issue Owner, assignee fallback) — not split.
    if (owner && isP1OrP2(b.priority) && b.completedAt && b.createdAt) {
      const minutes =
        (b.completedAt.getTime() - b.createdAt.getTime()) / 60_000;
      if (minutes >= 0) {
        const a = getAcc(owner);
        a.mttrSamples.push(minutes);
        a.mttrItems.push({
          key: b.jiraKey,
          summary: b.summary,
          priority: b.priority,
          minutes,
        });
      }
    }
  }

  // Pass 2 — tasks: features, complexity, AI tasks, sprint commitment.
  for (const t of tasks) {
    const assignee = normalizeEmail(t.assigneeEmail);
    if (!assignee) continue; // tasks with no assignee are dropped (§5.1)
    const a = getAcc(assignee);

    const rawComplexity = extractComplexity(t.customFields, t.complexityFieldIds);

    // Feature count — a task counts unless it matches a bug this user owns.
    if (!a.ownedBugKeys.has(t.jiraKey)) {
      a.features += 1;
      a.featureItems.push({
        key: t.jiraKey,
        summary: t.summary,
        complexity: rawComplexity,
      });
    }

    // Complexity weighting — every task counts.
    a.complexWeightedTotal += complexityWeight(rawComplexity);
    a.complexTotalTasks += 1;
    const bucketKey =
      rawComplexity == null
        ? "unset"
        : String(Math.min(5, Math.max(1, Math.round(rawComplexity))));
    a.complexityCounts.set(bucketKey, (a.complexityCounts.get(bucketKey) ?? 0) + 1);

    // AI / underestimated tasks — complex tasks (raw complexity ≥ 3).
    if (rawComplexity != null && rawComplexity >= COMPLEX_THRESHOLD) {
      a.totalComplex += 1;
      const estSeconds = extractOriginalEstimateSeconds(t.customFields) ?? 0;
      const estHours = estSeconds / 3600;
      if (estHours > 0 && estHours < AI_TASK_MAX_ESTIMATE_HOURS) a.aiTaskCount += 1;
    }

    // Sprint commitment — needs a due date; actual-end falls back to completedAt.
    const due = extractDueDate(t.customFields ?? {}, t.endDateFieldIds);
    if (due && t.completedAt) {
      a.sprintTotal += 1;
      const completedDate = t.completedAt.toISOString().slice(0, 10);
      if (completedDate <= due) a.sprintNotDelayed += 1;
    }
  }

  const computedAt = new Date();
  const records = [...accs.entries()].map(([email, a]) => {
    const inputs: ScorecardInputs = {
      features: a.features,
      weightedBugs: a.weightedBugs,
      mttrMinutesSamples: a.mttrSamples,
      sprintNotDelayed: a.sprintNotDelayed,
      sprintTotal: a.sprintTotal,
      complexWeightedTotal: a.complexWeightedTotal,
      complexTotalTasks: a.complexTotalTasks,
      aiTaskCount: a.aiTaskCount,
      totalComplex: a.totalComplex,
      churn: null, // no PR data on this platform (weight 0)
      effort: null, // no dev-hours data on this platform (weight 0)
    };
    const r = computeScorecard(inputs);
    // Sort item lists for a stable, readable drill-down: bugs by weight
    // (priority) desc, features by complexity desc, ties broken by key.
    const bugItems = a.bugItems.sort(
      (x, y) => y.weight - x.weight || x.key.localeCompare(y.key)
    );
    const featureItems = a.featureItems.sort(
      (x, y) => (y.complexity ?? 0) - (x.complexity ?? 0) || x.key.localeCompare(y.key)
    );
    const mttrItems = a.mttrItems.sort((x, y) => y.minutes - x.minutes);
    const complexity = buildComplexityBuckets(a.complexityCounts);
    const breakdown = {
      ...r.breakdown,
      items: {
        weightedBugs: bugItems,
        features: featureItems,
        mttr: mttrItems,
        complexity,
      },
    };
    return {
      userEmail: email,
      quarterKey,
      computedAt,
      weightedBugs: r.weightedBugs,
      featureCount: r.featureCount,
      bugQualityPoints: r.bugQualityPoints,
      mttrMinutes: r.mttrMinutes,
      mttrPoints: r.mttrPoints,
      sprintCommitmentNotDelayed: r.sprintCommitmentNotDelayed,
      sprintCommitmentTotal: r.sprintCommitmentTotal,
      sprintCommitmentPoints: r.sprintCommitmentPoints,
      complexTasksCount: r.complexTasksCount,
      complexTasksPoints: r.complexTasksPoints,
      underestimatedTasksCount: r.underestimatedTasksCount,
      underestimatedTasksPoints: r.underestimatedTasksPoints,
      finalScore: r.finalScore,
      breakdown,
    };
  });

  // Replace the quarter atomically: drop the prior run, insert the fresh set.
  await db.transaction(async (tx) => {
    await tx
      .delete(performanceScorecards)
      .where(eq(performanceScorecards.quarterKey, quarterKey));
    for (let i = 0; i < records.length; i += 500) {
      await tx.insert(performanceScorecards).values(records.slice(i, i + 500));
    }
  });

  return { quarterKey, developersScored: records.length };
}
