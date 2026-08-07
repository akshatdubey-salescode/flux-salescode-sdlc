// Loads quarter-scoped Jira data, derives the per-user scoring inputs (rating
// doc §5), runs the pure engine (engine.ts), and persists one
// performance_scorecards row per developer. Overwrites the quarter on each run.
//
// Four Jira Complexity Rating numbers are computed and persisted per
// developer, a 2×2 grid of {all-Jiras, self-assigned-excluded} ×
// {marked complexity, LOC-predicted ("expected") complexity}:
//   finalScore                 — COMPLEX. (M): all-Jiras, marked complexity.
//                                 This IS the original Performance Review
//                                 score — every completed Jira counts,
//                                 including self-created-and-assigned ones.
//                                 Unchanged from how this metric has always
//                                 worked; this file's job is to never alter
//                                 its scope.
//   expectedComplexityScoreAll — COMPLEX. (E): all-Jiras, LOC-predicted
//                                 complexity. Same population as finalScore,
//                                 differing only in the Complex Tasks input.
//   markedComplexityScore      — COMPLEX NSA. (M): identical formula to
//                                 finalScore, but self-assigned Jiras
//                                 (reporter === credited person) are excluded
//                                 entirely, at the point of attribution,
//                                 before anything is accumulated.
//   expectedComplexityScore    — COMPLEX NSA. (E): same self-assigned
//                                 exclusion as markedComplexityScore, except
//                                 Complex Tasks is weighted by LOC-predicted
//                                 complexity instead of the marked value.
//
// Bug Quality, MTTR, and Sprint Commitment are complexity-agnostic, so within
// each population (all-Jiras / NSA) the Marked and Expected readings are
// identical apart from the Complex Tasks contribution. Complexity Accuracy is
// tallied BOTH ways too (complexityAccuracyAllCorrect/Checked over every
// task, complexityAccuracyCorrect/Checked over the NSA population only) —
// shown in the drill-down, not the leaderboard.

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
// Score numbers. Sourced from the unfiltered (all-Jiras) population — see
// file header — so this always matches what Score itself counted.
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
  // True when the reporter is also the person credited for this task — it
  // still counts toward Score (this list is Score's own breakdown, unfiltered
  // — see file header), but is excluded from Complex. (M), Complex.
  // (E), and Complexity Accuracy. Surfaced here so a reviewer can see
  // *why* a task doesn't show up in those three, without guessing.
  selfAssigned: boolean;
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
  // value. Accumulated on both raw and excl — feeds expectedComplexityScoreAll
  // (COMPLEX. (E), all-Jiras) on raw and expectedComplexityScore (COMPLEX
  // NSA. (E)) on excl.
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

  // Complexity Accuracy tally — accumulated on both raw (every task, all
  // Jiras) and excl (non-self-assigned only), shown in the Details drill-down
  // as two separate readings. Never excluded for having an unset complexity
  // or no matched PR — both default to C1, see complexity-loc-thresholds.ts —
  // only whether marked complexity matches what the LOC predicts.
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
// ticket. Feeds only markedComplexityScore / expectedComplexityScore /
// Complexity Accuracy — the original Score (finalScore) counts every Jira
// regardless.
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

  // Two parallel accumulators per developer:
  //   rawAccs  — every Jira, including self-created-and-assigned. Feeds the
  //              original, unmodified Score (finalScore) and every existing
  //              sub-metric / drill-down list.
  //   exclAccs — self-assigned Jiras excluded at attribution time, before
  //              anything is accumulated. Feeds markedComplexityScore,
  //              expectedComplexityScore, and Complexity Accuracy only — it
  //              carries no breakdown of its own.
  const rawAccs = new Map<string, Acc>();
  const exclAccs = new Map<string, Acc>();
  const getAcc = (map: Map<string, Acc>, email: string): Acc => {
    let a = map.get(email);
    if (!a) {
      a = emptyAcc();
      map.set(email, a);
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
  //     matching the "Missing Issue Owner" bucket on the boards.
  //   • RESOLUTION CREDIT (priority-weighted) + MTTR → Dev Owner ?? Assignee:
  //     the developer who actually fixed it. The Issue Owner field is unreliable
  //     as "who did the work" (often someone else resolves it), so resolution is
  //     credited the same way tasks are. Credit feeds the Bug Quality numerator.
  // Both always count toward the raw (all-Jiras) accumulator; self-assigned
  // (reporter === credited person) additionally mirrors into the excl
  // accumulator only when it isn't self-assigned.
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
    if (owner) {
      const raw = getAcc(rawAccs, owner);
      raw.weightedBugs += weight;
      raw.ownedBugKeys.add(b.jiraKey);
      raw.bugItems.push({
        key: b.jiraKey,
        summary: b.summary,
        priority: b.priority,
        weight,
      });
      if (!isSelfAssigned(b.reporterEmail, owner)) {
        const excl = getAcc(exclAccs, owner);
        excl.weightedBugs += weight;
        excl.ownedBugKeys.add(b.jiraKey);
      }
    }

    // Resolution credit + MTTR → resolver (Dev Owner ?? Assignee).
    const resolver = resolveTaskOwnerEmail(
      b.customFields,
      b.devOwnerFieldIds,
      b.assigneeEmail,
      accountIdEmailMap
    );
    if (resolver) {
      const raw = getAcc(rawAccs, resolver);
      raw.bugsResolvedWeighted += weight;
      raw.resolvedBugItems.push({
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
        raw,
        b.jiraKey,
        b.summary,
        b.customFields,
        b.actualStartFieldIds,
        b.actualEndFieldIds
      );
      let mttrMinutes: number | null = null;
      if (isP1OrP2(b.priority)) {
        const { start, end } = devWindow(b);
        if (start && end) {
          const minutes = (end.getTime() - start.getTime()) / 60_000;
          if (minutes >= 0) {
            mttrMinutes = minutes;
            raw.mttrSamples.push(minutes);
            raw.mttrItems.push({
              key: b.jiraKey,
              summary: b.summary,
              priority: b.priority,
              minutes,
            });
          }
        }
      }
      if (!isSelfAssigned(b.reporterEmail, resolver)) {
        const excl = getAcc(exclAccs, resolver);
        excl.bugsResolvedWeighted += weight;
        if (mttrMinutes != null) excl.mttrSamples.push(mttrMinutes);
      }
    }
  }

  // Pass 2 — tasks: features, complexity, AI tasks, sprint commitment. Task
  // credit goes to the Dev Owner when set, else the Assignee (§5.1); a task
  // with neither is credited to nobody and dropped — this has nothing to do
  // with self-assignment. Every remaining task counts toward the raw (Score)
  // accumulator unconditionally; self-assigned ones simply don't also mirror
  // into the excl accumulator below.
  for (const t of tasks) {
    const owner = resolveTaskOwnerEmail(
      t.customFields,
      t.devOwnerFieldIds,
      t.assigneeEmail,
      accountIdEmailMap
    );
    if (!owner) continue;
    const raw = getAcc(rawAccs, owner);

    recordMissingActual(
      raw,
      t.jiraKey,
      t.summary,
      t.customFields,
      t.actualStartFieldIds,
      t.actualEndFieldIds
    );

    const rawComplexity = extractComplexity(t.customFields, t.complexityFieldIds);
    // Computed once per task and reused everywhere below — the LOC/expected-
    // complexity/self-assigned facts are the same regardless of which
    // accumulator ends up using them.
    const loc = locMap.get(t.jiraKey.toUpperCase()) ?? null;
    const expectedComplexity = expectedComplexityForLoc(loc, complexityLocRanges);
    const flagged = isComplexityLocMismatch(rawComplexity, loc, complexityLocRanges);
    const selfAssigned = isSelfAssigned(t.reporterEmail, owner);

    // Feature count — a task counts unless it matches a bug this user owns.
    if (!raw.ownedBugKeys.has(t.jiraKey)) {
      raw.features += 1;
      raw.featureItems.push({
        key: t.jiraKey,
        summary: t.summary,
        complexity: rawComplexity,
        loc,
        expectedComplexity,
        complexityMismatch: flagged,
        mismatchSuggestion: flagged ? mismatchSuggestion(rawComplexity) : null,
        selfAssigned,
      });
    }

    raw.complexWeightedTotal += complexityWeight(rawComplexity);
    // All-Jiras counterpart of excl.expectedComplexWeightedTotal below — feeds
    // expectedComplexityScoreAll (COMPLEX. (E) — the all-Jiras sibling of
    // COMPLEX NSA. (E)).
    raw.expectedComplexWeightedTotal += complexityWeight(expectedComplexity);
    raw.complexTotalTasks += 1;
    const bucketKey =
      rawComplexity == null
        ? "unset"
        : String(Math.min(5, Math.max(1, Math.round(rawComplexity))));
    raw.complexityCounts.set(bucketKey, (raw.complexityCounts.get(bucketKey) ?? 0) + 1);

    // All-Jiras Complexity Accuracy tally — the counterpart of excl's below,
    // over every task regardless of self-assignment. Shown in the Details
    // drill-down as the "all Jiras" reading, alongside the NSA one.
    raw.complexityChecked += 1;
    if (isComplexityCorrect(rawComplexity, loc, complexityLocRanges)) {
      raw.complexityCorrect += 1;
    }

    // AI / underestimated tasks — complex tasks (raw complexity ≥ 3).
    if (rawComplexity != null && rawComplexity >= COMPLEX_THRESHOLD) {
      raw.totalComplex += 1;
      const estSeconds = extractOriginalEstimateSeconds(t.customFields) ?? 0;
      const estHours = estSeconds / 3600;
      if (estHours > 0 && estHours < AI_TASK_MAX_ESTIMATE_HOURS) raw.aiTaskCount += 1;
    }

    // Sprint commitment — needs a due date; the delivery date is the end of the
    // developer work-window (Actual end → dev handoff → completedAt fallback),
    // so a ticket isn't marked late for QA time the developer doesn't control.
    const due = extractDueDate(t.customFields ?? {}, t.endDateFieldIds);
    const { end } = devWindow(t);
    let onTime: boolean | null = null;
    if (due && end) {
      raw.sprintTotal += 1;
      const completedDate = end.toISOString().slice(0, 10);
      onTime = completedDate <= due;
      if (onTime) raw.sprintNotDelayed += 1;
    }

    // Self-assigned-excluded population — feeds markedComplexityScore,
    // expectedComplexityScore, and Complexity Accuracy only. No item lists;
    // it's numbers-only, mirroring the same per-task facts computed above.
    if (!selfAssigned) {
      const excl = getAcc(exclAccs, owner);
      excl.complexityChecked += 1;
      if (isComplexityCorrect(rawComplexity, loc, complexityLocRanges)) {
        excl.complexityCorrect += 1;
      }
      if (!excl.ownedBugKeys.has(t.jiraKey)) excl.features += 1;
      excl.complexWeightedTotal += complexityWeight(rawComplexity);
      excl.expectedComplexWeightedTotal += complexityWeight(expectedComplexity);
      excl.complexTotalTasks += 1;
      if (due && end) {
        excl.sprintTotal += 1;
        if (onTime) excl.sprintNotDelayed += 1;
      }
    }
  }

  const computedAt = new Date();
  const emails = new Set<string>([...rawAccs.keys(), ...exclAccs.keys()]);
  const records = [...emails].map((email) => {
    const raw = rawAccs.get(email) ?? emptyAcc();
    const excl = exclAccs.get(email) ?? emptyAcc();

    const rawInputs: ScorecardInputs = {
      features: raw.features,
      bugsResolvedWeighted: raw.bugsResolvedWeighted,
      weightedBugs: raw.weightedBugs,
      mttrMinutesSamples: raw.mttrSamples,
      sprintNotDelayed: raw.sprintNotDelayed,
      sprintTotal: raw.sprintTotal,
      complexWeightedTotal: raw.complexWeightedTotal,
      complexTotalTasks: raw.complexTotalTasks,
      aiTaskCount: raw.aiTaskCount,
      totalComplex: raw.totalComplex,
      churn: null, // no PR data on this platform (weight 0)
      effort: null, // no dev-hours data on this platform (weight 0)
    };
    // The original, unmodified Score — every Jira this developer touched.
    // Also COMPLEX. (M): the all-Jiras Jira Complexity Rating using marked
    // complexity — identical formula and inputs to Score, so identical value;
    // exposed as its own field for the leaderboard's 2×2 rating grid.
    const r = computeScorecard(rawInputs);
    // COMPLEX. (E): the all-Jiras counterpart of COMPLEX NSA. (E) below —
    // same population as Score, but Complex Tasks weighted by LOC-predicted
    // complexity instead of marked.
    const allExpectedR = computeScorecard({
      ...rawInputs,
      complexWeightedTotal: raw.expectedComplexWeightedTotal,
    });

    const exclInputs: ScorecardInputs = {
      features: excl.features,
      bugsResolvedWeighted: excl.bugsResolvedWeighted,
      weightedBugs: excl.weightedBugs,
      mttrMinutesSamples: excl.mttrSamples,
      sprintNotDelayed: excl.sprintNotDelayed,
      sprintTotal: excl.sprintTotal,
      complexWeightedTotal: excl.complexWeightedTotal,
      complexTotalTasks: excl.complexTotalTasks,
      aiTaskCount: excl.aiTaskCount,
      totalComplex: excl.totalComplex,
      churn: null,
      effort: null,
    };
    // COMPLEX NSA. (M) — Jira Complexity Rating, self-assigned excluded.
    const markedR = computeScorecard(exclInputs);
    // COMPLEX NSA. (E) — identical, but Complex Tasks is weighted by
    // LOC-predicted complexity instead of the marked value.
    const expectedR = computeScorecard({
      ...exclInputs,
      complexWeightedTotal: excl.expectedComplexWeightedTotal,
    });

    // Sort item lists for a stable, readable drill-down: bugs by weight
    // (priority) desc, features by complexity desc, ties broken by key.
    // Sourced from raw — Score's own breakdown, unfiltered.
    const bugItems = raw.bugItems.sort(
      (x, y) => y.weight - x.weight || x.key.localeCompare(y.key)
    );
    const resolvedBugItems = raw.resolvedBugItems.sort(
      (x, y) => y.weight - x.weight || x.key.localeCompare(y.key)
    );
    const featureItems = raw.featureItems.sort(
      (x, y) => (y.complexity ?? 0) - (x.complexity ?? 0) || x.key.localeCompare(y.key)
    );
    const mttrItems = raw.mttrItems.sort((x, y) => y.minutes - x.minutes);
    const complexity = buildComplexityBuckets(raw.complexityCounts);
    // Missing both fields first (fully fallen back), then by key.
    const missingActualDates = raw.missingActualItems.sort(
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
      expectedComplexityScoreAll: allExpectedR.finalScore,
      markedComplexityScore: markedR.finalScore,
      expectedComplexityScore: expectedR.finalScore,
      complexityAccuracyAllCorrect: raw.complexityCorrect,
      complexityAccuracyAllChecked: raw.complexityChecked,
      complexityAccuracyCorrect: excl.complexityCorrect,
      complexityAccuracyChecked: excl.complexityChecked,
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
