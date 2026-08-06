// Loads quarter-scoped Jira data, derives the per-user scoring inputs (rating
// doc §5), runs the pure engine (engine.ts), and persists one
// performance_scorecards row per developer. Overwrites the quarter on each run.
//
// Self-assigned Jiras — where the reporter is also the person credited for the
// work (Issue Owner / resolver / Dev Owner ?? Assignee) — are excluded
// entirely, at the point of attribution, before anything is accumulated. They
// never reach any metric, any item list, or either score below.
//
// Two independent ratings are computed and persisted per developer: finalScore
// weights the Complex Tasks metric by each task's marked complexity (the
// actual rating); expectedComplexityScore uses the identical formula but
// weights it by the LOC-predicted complexity instead. Bug Quality, MTTR, and
// Sprint Commitment are complexity-agnostic, so they're identical between the
// two — only the Complex Tasks contribution (and therefore the total) can
// differ. Neither is a "raw vs adjusted" pair — self-assigned exclusion
// applies to both equally.

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  jiraIssues,
  jiraProjects,
  jiraIssueLoc,
  performanceScorecards,
} from "@/lib/db/schema";
import { loadAccountIdEmailMap } from "@/lib/jira/identity";
import {
  extractDueDate,
  extractActualStart,
  extractActualEnd,
} from "@/lib/jira/dates";
import { isWorkInQuarter } from "./scope";
import {
  extractComplexity,
  extractIssueOwnerEmail,
  extractOriginalEstimateSeconds,
  resolveTaskOwnerEmail,
  normalizeEmail,
} from "@/lib/jira/scorecard-fields";
import {
  isComplexityLocMismatch,
  mismatchSuggestion,
  isComplexityCorrect,
  expectedComplexityForLoc,
  getComplexityLocRanges,
} from "./complexity-loc-thresholds";
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
// tasks" tables, so the breakdown shows exactly which issues drove the
// numbers. Self-assigned issues never appear here — they're filtered out
// before attribution, not just hidden after the fact.
type BugItem = {
  key: string;
  summary: string;
  priority: string | null;
  weight: number;
};
type FeatureItem = {
  key: string;
  summary: string;
  complexity: number | null;
  // Additions + deletions summed across every PR loc-sync matched to this
  // Jira for this quarter; null when no PR has been matched (yet, or ever).
  loc: number | null;
  // What complexity the matched LOC would predict (complexity-loc-thresholds.ts
  // §expectedComplexityForLoc), shown alongside the marked value so a reviewer
  // sees the actual gap, not just a flag. Always populated — a null loc (no
  // matched PR) is treated as 0 LOC, predicting C1.
  expectedComplexity: number | null;
  // True when raw complexity is 4-5 but loc falls below that complexity's
  // expected floor (complexity-loc-thresholds.ts) — a possible over-rating.
  // Narrower than "expectedComplexity !== complexity": only the manager's
  // original C4/C5-over-rating case gets the ⚠ treatment; every other
  // mismatch is still visible via the Expected column, just not flagged.
  complexityMismatch: boolean;
  mismatchSuggestion: string | null;
};
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
// Scored issues lacking the "Actual start" / "Actual end" fields, so reviewers
// can see which issues fell back to status-history (or created/completed) dates
// for the time-based metrics rather than using team-set actuals.
type MissingActualDateItem = {
  key: string;
  summary: string;
  missingStart: boolean;
  missingEnd: boolean;
};

type Acc = {
  features: number;
  weightedBugs: number;
  bugsResolvedWeighted: number;
  ownedBugKeys: Set<string>;
  mttrSamples: number[];
  sprintNotDelayed: number;
  sprintTotal: number;
  complexWeightedTotal: number;
  // Same tasks, weighted by LOC-predicted complexity instead of the marked
  // value — feeds a second, independent "expected complexity" rating
  // alongside the actual one. See complexTasksPoints() in engine.ts; both
  // totals go through the exact same formula, just with a different input.
  expectedComplexWeightedTotal: number;
  complexTotalTasks: number;
  aiTaskCount: number;
  totalComplex: number;
  bugItems: BugItem[];
  resolvedBugItems: BugItem[];
  featureItems: FeatureItem[];
  mttrItems: MttrItem[];
  missingActualItems: MissingActualDateItem[];
  // Count of tasks per complexity bucket ("1".."5" or "unset"), for the
  // Complex-tasks distribution table.
  complexityCounts: Map<string, number>;

  // Complexity Accuracy tally: of every complexity-bearing task (never
  // excluded — an unset marked complexity or a task with no matched PR both
  // default to C1 rather than being dropped, see complexity-loc-thresholds.ts),
  // how many had marked complexity match what the LOC predicts.
  complexityChecked: number;
  complexityCorrect: number;
};

function emptyAcc(): Acc {
  return {
    features: 0,
    weightedBugs: 0,
    bugsResolvedWeighted: 0,
    ownedBugKeys: new Set(),
    mttrSamples: [],
    sprintNotDelayed: 0,
    sprintTotal: 0,
    complexWeightedTotal: 0,
    expectedComplexWeightedTotal: 0,
    complexTotalTasks: 0,
    aiTaskCount: 0,
    totalComplex: 0,
    bugItems: [],
    resolvedBugItems: [],
    featureItems: [],
    mttrItems: [],
    missingActualItems: [],
    complexityCounts: new Map(),
    complexityChecked: 0,
    complexityCorrect: 0,
  };
}

// A Jira is "self-assigned" when the person who reported it is also the
// person credited for the work (Issue Owner for a bug penalty, resolver for
// bug credit, Dev Owner ?? Assignee for tasks) — i.e. they created their own
// ticket. Excluded entirely: skipped before any accumulation, so it never
// reaches a metric, an item list, or the score.
export function isSelfAssigned(
  reporterEmail: string | null | undefined,
  creditedEmail: string
): boolean {
  const reporter = normalizeEmail(reporterEmail);
  return reporter != null && reporter === creditedEmail;
}

// Records an issue on the developer's "missing actual dates" list when either
// the Actual start or Actual end field is empty. cf is the issue's customFields;
// startIds / endIds are the project's discovered actual-date field IDs.
function recordMissingActual(
  a: Acc,
  jiraKey: string,
  summary: string,
  cf: Record<string, unknown> | null,
  startIds: string[] | null,
  endIds: string[] | null
): void {
  const fields = cf ?? {};
  const missingStart = extractActualStart(fields, startIds) == null;
  const missingEnd = extractActualEnd(fields, endIds) == null;
  if (missingStart || missingEnd) {
    a.missingActualItems.push({ key: jiraKey, summary, missingStart, missingEnd });
  }
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

// The developer work-window for an issue — the span the engine treats as "time
// the developer was actually responsible for the work". MTTR and sprint
// commitment use this instead of raw created→completed so neither penalizes the
// developer for time outside active development: days a ticket sits unassigned
// in the backlog before work starts, or sits in QA after the dev hands it off.
//
// Resolved in priority order:
//   1. The team-set "Actual start" / "Actual end" datetime fields, when present.
//   2. The changelog-derived dev window: dev_started_at (first entry into an
//      In Progress status) → dev_completed_at (first handoff into In QA / Done).
//   3. Raw Jira created_at → completed_at, as a last resort, so an issue whose
//      workflow never used an In Progress status is still scored rather than
//      silently dropped.
function devWindow(row: {
  customFields: Record<string, unknown> | null;
  actualStartFieldIds: string[] | null;
  actualEndFieldIds: string[] | null;
  devStartedAt: Date | null;
  devCompletedAt: Date | null;
  createdAt: Date | null;
  completedAt: Date | null;
}): { start: Date | null; end: Date | null } {
  const cf = row.customFields ?? {};
  const start =
    extractActualStart(cf, row.actualStartFieldIds) ??
    row.devStartedAt ??
    row.createdAt;
  const end =
    extractActualEnd(cf, row.actualEndFieldIds) ??
    row.devCompletedAt ??
    row.completedAt;
  return { start, end };
}

export type BuildResult = { quarterKey: string; developersScored: number };

/**
 * Recompute every developer's scorecard for the given quarter key (e.g.
 * "FY2026-Q1") and persist it, replacing any prior run for that quarter.
 */
export async function buildScorecards(quarterKey: string): Promise<BuildResult> {
  const quarter = quarterFromKey(quarterKey);
  if (!quarter) throw new Error(`Invalid quarter key: ${quarterKey}`);

  // Fetched fresh every run — a database config (feature_flags), never
  // cached, so an edit to the thresholds takes effect on the very next
  // Recompute/Sync LOC, not after some cache TTL lapses.
  const complexityLocRanges = await getComplexityLocRanges();

  const accountIdEmailMap = await loadAccountIdEmailMap();

  // Candidate issues: completed within the quarter (must be Done), with their
  // project's discovered custom-field IDs (for complexity / issue-owner /
  // due-date / actual-date extraction). Creation date is intentionally NOT a
  // filter — quarter membership is decided in JS below by where the WORK
  // finished (see isWorkInQuarter), so carryover raised in an earlier quarter
  // but delivered here still counts. completedAt-in-quarter is the candidate
  // net; isWorkInQuarter then applies the Actual/planned finish + backdating
  // rules. (Edge: an issue whose Actual end lands in-quarter but whose Done
  // date is in another quarter isn't fetched here — rare, and completedAt is
  // the canonical "delivered" signal.)
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
      devStartedAt: jiraIssues.devStartedAt,
      devCompletedAt: jiraIssues.devCompletedAt,
      complexityFieldIds: jiraProjects.complexityFieldIds,
      issueOwnerFieldIds: jiraProjects.issueOwnerFieldIds,
      devOwnerFieldIds: jiraProjects.devOwnerFieldIds,
      startDateFieldIds: jiraProjects.startDateFieldIds,
      endDateFieldIds: jiraProjects.endDateFieldIds,
      actualStartFieldIds: jiraProjects.actualStartFieldIds,
      actualEndFieldIds: jiraProjects.actualEndFieldIds,
    })
    .from(jiraIssues)
    .innerJoin(jiraProjects, eq(jiraIssues.projectId, jiraProjects.id))
    .where(
      and(
        sql`${jiraIssues.completedAt} is not null`,
        sql`${jiraIssues.completedAt}::date >= ${quarter.start}::date`,
        sql`${jiraIssues.completedAt}::date <= ${quarter.end}::date`
      )
    );

  // Precomputed LOC per Jira for this quarter (written by loc-sync, never
  // recomputed here) — keyed upper-case, additions + deletions summed.
  const locRows = await db
    .select({
      jiraKey: jiraIssueLoc.jiraKey,
      totalAdditions: jiraIssueLoc.totalAdditions,
      totalDeletions: jiraIssueLoc.totalDeletions,
    })
    .from(jiraIssueLoc)
    .where(eq(jiraIssueLoc.quarterKey, quarterKey));
  const locMap = new Map<string, number>();
  for (const l of locRows) {
    locMap.set(l.jiraKey.toUpperCase(), l.totalAdditions + l.totalDeletions);
  }

  const accs = new Map<string, Acc>();
  const getAcc = (email: string): Acc => {
    let a = accs.get(email);
    if (!a) {
      a = emptyAcc();
      accs.set(email, a);
    }
    return a;
  };

  // Quarter scope: keep issues whose work finished this quarter, dropping
  // backdated tickets — see isWorkInQuarter for the full rule.
  const scoped = rows.filter((r) => isWorkInQuarter(r, quarter));

  // Partition so all bug ownership is known before tasks compute feature count.
  const bugs: typeof scoped = [];
  const tasks: typeof scoped = [];
  for (const r of scoped) {
    if (BUG_ISSUE_TYPES.has((r.issueType ?? "").trim().toLowerCase())) bugs.push(r);
    else tasks.push(r);
  }

  // Pass 1 — bugs, split two ways:
  //   • PENALTY (weighted bugs) → Issue Owner: accountability for the defect.
  //     Issue Owner field only; a bug with no Issue Owner is penalized to nobody,
  //     matching the "Missing Issue Owner" bucket on the boards. Self-assigned
  //     (reporter === Issue Owner) is excluded — the bug never reaches this
  //     developer's penalty at all.
  //   • RESOLUTION CREDIT (priority-weighted) + MTTR → Dev Owner ?? Assignee:
  //     the developer who actually fixed it. The Issue Owner field is unreliable
  //     as "who did the work" (often someone else resolves it), so resolution is
  //     credited the same way tasks are. Credit feeds the Bug Quality numerator.
  //     Self-assigned (reporter === resolver) is excluded the same way.
  for (const b of bugs) {
    // not a bug / couldn't reproduce → excluded from all scoring
    if (BUG_INVALID_STATUSES.has(normalizeStatus(b.status))) continue;

    const weight = priorityWeight(b.priority);

    // Penalty → Issue Owner.
    const owner = extractIssueOwnerEmail(
      b.customFields,
      b.issueOwnerFieldIds,
      accountIdEmailMap
    );
    if (owner && !isSelfAssigned(b.reporterEmail, owner)) {
      const a = getAcc(owner);
      a.weightedBugs += weight;
      a.ownedBugKeys.add(b.jiraKey);
      a.bugItems.push({
        key: b.jiraKey,
        summary: b.summary,
        priority: b.priority,
        weight,
      });
    }

    // Resolution credit + MTTR → resolver (Dev Owner ?? Assignee).
    const resolver = resolveTaskOwnerEmail(
      b.customFields,
      b.devOwnerFieldIds,
      b.assigneeEmail,
      accountIdEmailMap
    );
    if (resolver && !isSelfAssigned(b.reporterEmail, resolver)) {
      const a = getAcc(resolver);
      a.bugsResolvedWeighted += weight;
      a.resolvedBugItems.push({
        key: b.jiraKey,
        summary: b.summary,
        priority: b.priority,
        weight,
      });
      // Missing-actual note follows the time-based metric (MTTR), now the
      // resolver's. Resolution time is measured over the developer work-window
      // (see devWindow), not raw created→completed, so the resolver isn't
      // charged for backlog/QA time outside active development. P1/P2 only.
      recordMissingActual(
        a,
        b.jiraKey,
        b.summary,
        b.customFields,
        b.actualStartFieldIds,
        b.actualEndFieldIds
      );
      if (isP1OrP2(b.priority)) {
        const { start, end } = devWindow(b);
        if (start && end) {
          const minutes = (end.getTime() - start.getTime()) / 60_000;
          if (minutes >= 0) {
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
    }
  }

  // Pass 2 — tasks: features, complexity, AI tasks, sprint commitment.
  for (const t of tasks) {
    // Task credit goes to the Dev Owner when set, else the Assignee (§5.1); a
    // task with neither is credited to nobody and dropped. Self-assigned
    // (reporter === owner) is excluded entirely too — the task contributes
    // nothing for this developer, not even the Complexity Accuracy tally.
    const owner = resolveTaskOwnerEmail(
      t.customFields,
      t.devOwnerFieldIds,
      t.assigneeEmail,
      accountIdEmailMap
    );
    if (!owner) continue;
    if (isSelfAssigned(t.reporterEmail, owner)) continue;
    const a = getAcc(owner);

    recordMissingActual(
      a,
      t.jiraKey,
      t.summary,
      t.customFields,
      t.actualStartFieldIds,
      t.actualEndFieldIds
    );

    const rawComplexity = extractComplexity(t.customFields, t.complexityFieldIds);
    // Computed once per task (not just feature-counted ones) so the Complexity
    // Accuracy tally covers every complexity-bearing task, and re-derives fresh
    // on every recompute — if Jira's complexity value changes, or loc-sync
    // matches a new PR, the next Recompute picks it up automatically; nothing
    // here is cached from a prior run. isComplexityCorrect never excludes a
    // task (unset complexity / no matched PR both default rather than drop),
    // so complexityChecked increments unconditionally — every (non-self-
    // assigned) task counts.
    const loc = locMap.get(t.jiraKey.toUpperCase()) ?? null;
    // Computed once and reused for both the drill-down display and the
    // expected-complexity rating below — same "no PR → 0 LOC → predicts C1"
    // rule as everywhere else in this file.
    const expectedComplexity = expectedComplexityForLoc(loc, complexityLocRanges);
    a.complexityChecked += 1;
    if (isComplexityCorrect(rawComplexity, loc, complexityLocRanges)) a.complexityCorrect += 1;

    // Feature count — a task counts unless it matches a bug this user owns.
    if (!a.ownedBugKeys.has(t.jiraKey)) {
      a.features += 1;
      const flagged = isComplexityLocMismatch(rawComplexity, loc, complexityLocRanges);
      a.featureItems.push({
        key: t.jiraKey,
        summary: t.summary,
        complexity: rawComplexity,
        loc,
        expectedComplexity,
        complexityMismatch: flagged,
        mismatchSuggestion: flagged ? mismatchSuggestion(rawComplexity) : null,
      });
    }

    // Complexity weighting — every (non-self-assigned) task counts, twice:
    // once by the marked complexity (the actual rating), once by the LOC-
    // predicted complexity (a second, independent rating — see
    // expectedComplexWeightedTotal below). Same task count feeds both.
    a.complexWeightedTotal += complexityWeight(rawComplexity);
    a.expectedComplexWeightedTotal += complexityWeight(expectedComplexity);
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

    // Sprint commitment — needs a due date; the delivery date is the end of the
    // developer work-window (Actual end → dev handoff → completedAt fallback),
    // so a ticket isn't marked late for QA time the developer doesn't control.
    const due = extractDueDate(t.customFields ?? {}, t.endDateFieldIds);
    const { end } = devWindow(t);
    if (due && end) {
      a.sprintTotal += 1;
      const completedDate = end.toISOString().slice(0, 10);
      if (completedDate <= due) a.sprintNotDelayed += 1;
    }
  }

  const computedAt = new Date();
  const records = [...accs.entries()].map(([email, a]) => {
    const inputs: ScorecardInputs = {
      features: a.features,
      bugsResolvedWeighted: a.bugsResolvedWeighted,
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

    // Second, independent rating: identical inputs except the Complex Tasks
    // metric is weighted by LOC-predicted complexity instead of the marked
    // value. Bug Quality / MTTR / Sprint Commitment are complexity-agnostic,
    // so they're unchanged — only complexTasksPoints (and therefore
    // finalScore) can differ between the two.
    const expectedInputs: ScorecardInputs = {
      ...inputs,
      complexWeightedTotal: a.expectedComplexWeightedTotal,
    };
    const expectedR = computeScorecard(expectedInputs);

    // Sort item lists for a stable, readable drill-down: bugs by weight
    // (priority) desc, features by complexity desc, ties broken by key.
    const bugItems = a.bugItems.sort(
      (x, y) => y.weight - x.weight || x.key.localeCompare(y.key)
    );
    const resolvedBugItems = a.resolvedBugItems.sort(
      (x, y) => y.weight - x.weight || x.key.localeCompare(y.key)
    );
    const featureItems = a.featureItems.sort(
      (x, y) => (y.complexity ?? 0) - (x.complexity ?? 0) || x.key.localeCompare(y.key)
    );
    const mttrItems = a.mttrItems.sort((x, y) => y.minutes - x.minutes);
    const complexity = buildComplexityBuckets(a.complexityCounts);
    // Missing both fields first (fully fallen back), then by key.
    const missingActualDates = a.missingActualItems.sort(
      (x, y) =>
        Number(y.missingStart && y.missingEnd) -
          Number(x.missingStart && x.missingEnd) || x.key.localeCompare(y.key)
    );
    const breakdown = {
      ...r.breakdown,
      items: {
        weightedBugs: bugItems,
        bugsResolved: resolvedBugItems,
        features: featureItems,
        mttr: mttrItems,
        complexity,
        missingActualDates,
      },
    };
    return {
      userEmail: email,
      quarterKey,
      computedAt,
      weightedBugs: r.weightedBugs,
      featureCount: r.featureCount,
      bugsResolvedWeighted: r.bugsResolvedWeighted,
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
      expectedComplexityScore: expectedR.finalScore,
      complexityAccuracyCorrect: a.complexityCorrect,
      complexityAccuracyChecked: a.complexityChecked,
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
