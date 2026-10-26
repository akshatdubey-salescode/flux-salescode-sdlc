// Database + storage operations for Test Case submissions. Pure parsing,
// normalisation and naming live in the sibling modules; this file only wires
// them to Postgres and the blob store.

import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  jiraIssues,
  jiraProjects,
  tcCases,
  tcFiles,
  tcReviewers,
  tcRounds,
  tcSets,
} from "@/lib/db/schema";
import { getStore, XLSX_CONTENT_TYPE } from "@/lib/storage";
import { buildTcFileName, buildTcS3Key, roundLabel } from "./filenames";
import { contentHash } from "./content-hash";
import { lockItem } from "./concurrency";
import { getProjectFolder } from "./project-folder-service";
import { checkLock, getItemLock, SourceLockedError } from "./lock";
import { RuleError } from "./rule-error";
import type { MultiParsed, TabGrid } from "./multi-tab";
import { recomputeSafely } from "./stats-service";
import type { RoundScope } from "./scope";
import { AI_OPENING_STATE, applyCarryOver, requiredReviewersMissing, roundStatusFrom } from "./state";
import { buildSnapshotXlsx } from "./xlsx";
import { AI_REVIEWER_EMAIL, AI_REVIEWER_NAME, isAiReviewer, type TcReviewerState, type TcRoundStatus, type TcSource } from "./values";

export type IssueRef = {
  id: string;
  jiraKey: string;
  summary: string;
  issueType: string;
  status: string;
  projectId: string;
  projectName: string;
  projectKey: string;
  jiraBaseUrl: string;
};

export type IssueLookup =
  | { kind: "found"; issue: IssueRef }
  | { kind: "none" }
  | { kind: "ambiguous"; issues: IssueRef[] };

const issueSelect = {
  id: jiraIssues.id,
  jiraKey: jiraIssues.jiraKey,
  summary: jiraIssues.summary,
  issueType: jiraIssues.issueType,
  status: jiraIssues.status,
  projectId: jiraIssues.projectId,
  projectName: jiraProjects.name,
  projectKey: jiraProjects.jiraProjectKey,
  jiraBaseUrl: jiraProjects.jiraBaseUrl,
};

/** Look an issue up by its internal id, or by Jira key (which can repeat across Jira sites). */
export async function findIssue(ref: { issueId?: string; key?: string }): Promise<IssueLookup> {
  if (!ref.issueId && !ref.key) return { kind: "none" };
  const rows = await db
    .select(issueSelect)
    .from(jiraIssues)
    .innerJoin(jiraProjects, eq(jiraProjects.id, jiraIssues.projectId))
    .where(
      ref.issueId
        ? eq(jiraIssues.id, ref.issueId)
        : sql`upper(${jiraIssues.jiraKey}) = ${ref.key!.trim().toUpperCase()}`,
    )
    .limit(5);
  if (rows.length === 0) return { kind: "none" };
  if (rows.length > 1) return { kind: "ambiguous", issues: rows };
  return { kind: "found", issue: rows[0] };
}

export type CommitArgs = {
  issue: IssueRef;
  committer: { email: string; name: string | null };
  source: TcSource;
  sheetUrl: string | null;
  spreadsheetId: string | null;
  /** Every tab of the item, parsed and merged (case keys are tab-qualified). */
  parsed: Extract<MultiParsed, { ok: true }>;
  /** The raw values of those tabs, for the snapshot. */
  grids: TabGrid[];
  reviewers: { email: string; name: string | null }[];
  notes: string | null;
  /** Admins may remove a reviewer who asked for changes; the submitter may not. */
  isAdmin: boolean;
  /** SHA-256 of the uploaded workbook (Excel source), to recognise the same file on other items. */
  sourceHash: string | null;
  /** Which tabs and rows of the sheet this round reviewed. */
  scope: RoundScope;
  /** The AI review is on: the round gets the AI reviewer, waiting for its run, so it can't be approved before that. */
  aiReview?: boolean;
};

export type CommitResult = {
  setId: string;
  roundId: string;
  roundNo: number;
  fileId: string;
  fileName: string;
  /** Status of the new round after carrying reviewers' decisions over. */
  roundStatus: TcRoundStatus;
  /** Reviewers who still have to act (pending, or asked for changes before); the only ones emailed. */
  needsAction: { email: string; name: string | null }[];
  /** Reviewers whose earlier approval stands. */
  carriedApprovals: string[];
};

const CASE_CHUNK = 200;

export async function commitRound(args: CommitArgs): Promise<CommitResult> {
  const { issue, committer, parsed } = args;
  const at = new Date();

  // Slow work first, outside any lock: build the snapshot and upload it. The key has no round
  // number (it is only known under the lock) and a random nonce, so it can never collide.
  const headerRows = new Map(parsed.tabs.map((t) => [t.title, t.headerRow]));
  const snapshot = await buildSnapshotXlsx({
    tabs: args.grids.map((g) => ({ title: g.title, grid: g.grid, headerRow: headerRows.get(g.title) ?? 1 })),
  });
  const nameParts = { kind: "testcases" as const, round: 0, project: issue.projectName, jiraKey: issue.jiraKey, feature: issue.summary, user: committer.email, at };
  const folder = await getProjectFolder({ id: issue.projectId, name: issue.projectName, key: issue.projectKey });
  const storageKey = buildTcS3Key({ ...nameParts, folder });
  await getStore().put(storageKey, snapshot, XLSX_CONTENT_TYPE);

  const tabTitles = parsed.tabs.map((t) => t.title);
  const snapshotHash = contentHash(args.grids);

  let result: CommitResult;
  try {
    result = await db.transaction(async (tx) => {
      // From here to the end of the transaction nobody else can commit, decide, sign off or delete on this item.
      await lockItem(tx, issue.id);

      // The source is fixed by the first submission: checked here, under the lock, so two first commits can't both pass.
      const lock = await getItemLock(issue.id, tx);
      const verdict = checkLock(lock, { source: args.source, spreadsheetId: args.spreadsheetId });
      if (!verdict.ok) throw new SourceLockedError(verdict.reason);

      // One set per issue; created on the first commit.
      await tx
        .insert(tcSets)
        .values({ issueId: issue.id, projectId: issue.projectId, createdBy: committer.email, createdByName: committer.name })
        .onConflictDoNothing({ target: tcSets.issueId });
      const [set] = await tx.select().from(tcSets).where(eq(tcSets.issueId, issue.id)).limit(1);

      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${tcRounds.roundNo}), 0) + 1` })
        .from(tcRounds)
        .where(eq(tcRounds.setId, set.id));
      const roundNo = Number(next);
      const fileName = buildTcFileName({ ...nameParts, round: roundNo });

      // Reviewers carry over from the previous round: approvals and pending stay,
      // only those who asked for changes go back to re-review.
      const [prevRound] = await tx
        .select({ id: tcRounds.id })
        .from(tcRounds)
        .where(eq(tcRounds.setId, set.id))
        .orderBy(desc(tcRounds.roundNo))
        .limit(1);
      const previous = prevRound
        ? await tx
            .select({
              email: tcReviewers.email,
              name: tcReviewers.name,
              state: tcReviewers.state,
              decidedAt: tcReviewers.decidedAt,
              decidedRoundNo: tcReviewers.decidedRoundNo,
            })
            .from(tcReviewers)
            .where(eq(tcReviewers.roundId, prevRound.id))
        : [];

      // Dropping the reviewer who objected would make the objection disappear.
      const stuck = requiredReviewersMissing(previous, args.reviewers, args.isAdmin);
      if (stuck.length > 0) {
        throw new RuleError(
          400,
          `${stuck.join(", ")} asked for changes and must stay on the reviewer list until they re-review. Only an admin can remove them.`,
          "required_reviewer",
        );
      }

      const humans = applyCarryOver(previous, args.reviewers);
      // The AI reviewer starts every round waiting for its run, whatever it said before (a run follows each submission).
      const carried = args.aiReview
        ? [...humans, { email: AI_REVIEWER_EMAIL, name: AI_REVIEWER_NAME, state: AI_OPENING_STATE, decidedAt: null, decidedRoundNo: null }]
        : humans;
      const status = roundStatusFrom(carried.map((r) => r.state));

      const [file] = await tx
        .insert(tcFiles)
        .values({
          setId: set.id,
          kind: "testcases",
          roundNo,
          storageKey,
          fileName,
          sizeBytes: snapshot.length,
          uploadedBy: committer.email,
          uploadedByName: committer.name,
          uploadedAt: at,
          contentHash: snapshotHash,
        })
        .returning({ id: tcFiles.id });

      const [round] = await tx
        .insert(tcRounds)
        .values({
          setId: set.id,
          roundNo,
          source: args.source,
          sheetUrl: args.sheetUrl,
          spreadsheetId: args.spreadsheetId,
          sheetTab: tabTitles[0] ?? null,
          sheetTabs: tabTitles,
          snapshotFileId: file.id,
          sourceHash: args.sourceHash,
          scope: args.scope,
          notes: args.notes,
          tcCount: parsed.cases.length,
          status,
          committedBy: committer.email,
          committedByName: committer.name,
          committedAt: at,
        })
        .returning({ id: tcRounds.id });

      for (let i = 0; i < parsed.cases.length; i += CASE_CHUNK) {
        await tx.insert(tcCases).values(
          parsed.cases.slice(i, i + CASE_CHUNK).map((c) => ({
            roundId: round.id,
            rowNo: c.rowNumber,
            sheetTab: c.sheetTab,
            tcCode: c.tcId,
            tcKey: c.tcKey,
            section: c.section,
            sectionNo: c.sectionNo,
            title: c.title,
            module: c.module,
            polarity: c.polarity,
            category: c.category,
            severity: c.severity,
            priority: c.priority,
            preconditions: c.preconditions,
            steps: c.steps,
            expected: c.expected,
            shareWithClient: c.shareWithClient,
            devStatus: c.devStatus,
            devRemarks: c.devRemarks,
            baReview: c.baReview,
            baRemarks: c.baRemarks,
            testerStatus: c.testerStatus,
            testerRemarks: c.testerRemarks,
            testerMeta: c.testerMeta,
            raw: c.raw,
          })),
        );
      }

      await tx.insert(tcReviewers).values(
        carried.map((r) => ({
          roundId: round.id,
          email: r.email,
          name: r.name,
          state: r.state,
          decidedAt: r.decidedAt,
          decidedRoundNo: r.decidedRoundNo,
        })),
      );
      await tx.update(tcSets).set({ updatedAt: at }).where(eq(tcSets.id, set.id));

      const mustAct = (st: TcReviewerState) => st === "pending" || st === "re_review";
      return {
        setId: set.id,
        roundId: round.id,
        roundNo,
        fileId: file.id,
        fileName,
        roundStatus: status,
        needsAction: humans.filter((r) => mustAct(r.state)).map((r) => ({ email: r.email, name: r.name })),
        carriedApprovals: humans.filter((r) => r.state === "approved" && (r.decidedRoundNo ?? roundNo) < roundNo).map((r) => r.email),
      };
    });
  } catch (err) {
    // The transaction rolled back, so the uploaded file belongs to nothing: remove it.
    await getStore().delete(storageKey).catch((e) => console.error("[test-cases] could not remove orphaned upload", storageKey, e));
    throw err;
  }

  await recomputeSafely(result.setId);
  return result;
}

/** Reviewers from the issue's latest round, to prefill the next submission. */
export async function previousReviewers(
  issueId: string,
): Promise<{ email: string; name: string | null; state: TcReviewerState; decidedRoundNo: number | null }[]> {
  const [latest] = await db
    .select({ id: tcRounds.id })
    .from(tcRounds)
    .innerJoin(tcSets, eq(tcSets.id, tcRounds.setId))
    .where(eq(tcSets.issueId, issueId))
    .orderBy(desc(tcRounds.roundNo))
    .limit(1);
  if (!latest) return [];
  const rows = await db
    .select({ email: tcReviewers.email, name: tcReviewers.name, state: tcReviewers.state, decidedRoundNo: tcReviewers.decidedRoundNo })
    .from(tcReviewers)
    .where(eq(tcReviewers.roundId, latest.id))
    .orderBy(asc(tcReviewers.createdAt));
  // The AI reviewer is added by the system, never pre-filled as an assignee.
  return rows.filter((r) => !isAiReviewer(r.email));
}

/**
 * What the cases table needs to draw a row. The long text (module, preconditions, steps, expected result) is
 * loaded only when a row is expanded (see CaseDetail / the cases/[caseId] route): at a few hundred cases it was
 * most of the page's size.
 */
export type CaseView = {
  id: string;
  rowNo: number;
  sheetTab: string;
  tcCode: string;
  section: string | null;
  title: string;
  category: string;
  polarity: string | null;
  severity: string | null;
  priority: string | null;
  devStatus: string;
  testerStatus: string;
};

export type CaseDetail = { module: string | null; preconditions: string; steps: string; expected: string; baReview: string; baRemarks: string };

export type RoundView = {
  id: string;
  roundNo: number;
  label: string;
  source: TcSource;
  sheetUrl: string | null;
  sheetTab: string | null;
  /** Every tab of the item's test cases in this round. */
  sheetTabs: string[];
  /** Which tabs and rows were reviewed (null for rounds from before rows could be chosen: every row of the tabs). */
  scope: RoundScope | null;
  notes: string | null;
  tcCount: number;
  status: string;
  committedBy: string;
  committedByName: string | null;
  committedAt: string;
  snapshotFile: { id: string; fileName: string; sizeBytes: number } | null;
  reviewers: { email: string; name: string | null; state: TcReviewerState; decidedAt: string | null; decidedRoundNo: number | null }[];
};

export type SetDetail = {
  setId: string;
  rounds: RoundView[];
  selectedRoundNo: number;
  cases: CaseView[];
};

export async function fetchSetDetail(issueId: string, roundNo?: number): Promise<SetDetail | null> {
  const [set] = await db.select().from(tcSets).where(eq(tcSets.issueId, issueId)).limit(1);
  if (!set) return null;

  const rounds = await db.select().from(tcRounds).where(eq(tcRounds.setId, set.id)).orderBy(desc(tcRounds.roundNo));
  if (rounds.length === 0) return null;

  const roundIds = rounds.map((r) => r.id);
  const [files, reviewers] = await Promise.all([
    db.select().from(tcFiles).where(eq(tcFiles.setId, set.id)),
    db.select().from(tcReviewers).where(inArray(tcReviewers.roundId, roundIds)).orderBy(asc(tcReviewers.createdAt)),
  ]);
  const fileById = new Map(files.map((f) => [f.id, f]));

  const views: RoundView[] = rounds.map((r) => {
    const f = r.snapshotFileId ? fileById.get(r.snapshotFileId) : undefined;
    return {
      id: r.id,
      roundNo: r.roundNo,
      label: roundLabel(r.roundNo, r.committedAt),
      source: r.source,
      sheetUrl: r.sheetUrl,
      sheetTab: r.sheetTab,
      sheetTabs: r.sheetTabs.length > 0 ? r.sheetTabs : r.sheetTab ? [r.sheetTab] : [],
      scope: r.scope ?? null,
      notes: r.notes,
      tcCount: r.tcCount,
      status: r.status,
      committedBy: r.committedBy,
      committedByName: r.committedByName,
      committedAt: r.committedAt.toISOString(),
      snapshotFile: f ? { id: f.id, fileName: f.fileName, sizeBytes: f.sizeBytes } : null,
      reviewers: reviewers
        .filter((x) => x.roundId === r.id)
        .map((x) => ({
          email: x.email,
          name: x.name,
          state: x.state,
          decidedAt: x.decidedAt?.toISOString() ?? null,
          decidedRoundNo: x.decidedRoundNo,
        })),
    };
  });

  const selected = views.find((v) => v.roundNo === roundNo) ?? views[0];
  // Only the columns a row needs: `raw` (every original cell) and the long text stay in the database.
  const cases = await db
    .select({
      id: tcCases.id,
      rowNo: tcCases.rowNo,
      sheetTab: tcCases.sheetTab,
      tcCode: tcCases.tcCode,
      section: tcCases.section,
      title: tcCases.title,
      category: tcCases.category,
      polarity: tcCases.polarity,
      severity: tcCases.severity,
      priority: tcCases.priority,
      devStatus: tcCases.devStatus,
      testerStatus: tcCases.testerStatus,
    })
    .from(tcCases)
    .where(eq(tcCases.roundId, selected.id))
    .orderBy(asc(tcCases.rowNo));

  return {
    setId: set.id,
    rounds: views,
    selectedRoundNo: selected.roundNo,
    cases,
  };
}

export async function getFileForDownload(fileId: string): Promise<{ storageKey: string; fileName: string } | null> {
  const [f] = await db
    .select({ storageKey: tcFiles.storageKey, fileName: tcFiles.fileName })
    .from(tcFiles)
    .where(eq(tcFiles.id, fileId))
    .limit(1);
  return f ?? null;
}

export async function fetchCaseDetail(caseId: string): Promise<CaseDetail | null> {
  const [c] = await db
    .select({
      module: tcCases.module,
      preconditions: tcCases.preconditions,
      steps: tcCases.steps,
      expected: tcCases.expected,
      baReview: tcCases.baReview,
      baRemarks: tcCases.baRemarks,
    })
    .from(tcCases)
    .where(eq(tcCases.id, caseId))
    .limit(1);
  return c ?? null;
}

/** The newest round's content fingerprint, to tell whether a resubmission changes anything. */
export async function latestContentHash(issueId: string): Promise<{ roundNo: number; hash: string } | null> {
  const [row] = await db
    .select({ roundNo: tcRounds.roundNo, hash: tcFiles.contentHash })
    .from(tcRounds)
    .innerJoin(tcSets, eq(tcSets.id, tcRounds.setId))
    .leftJoin(tcFiles, eq(tcFiles.id, tcRounds.snapshotFileId))
    .where(eq(tcSets.issueId, issueId))
    .orderBy(desc(tcRounds.roundNo))
    .limit(1);
  return row?.hash ? { roundNo: row.roundNo, hash: row.hash } : null;
}

export type SameWorkbook = { issueId: string; issueKey: string; roundNo: number };

/**
 * Other items in the SAME project whose round came from a byte-identical uploaded workbook. The same file
 * in another project is a separate copy with its own history, so it is deliberately not matched.
 */
export async function sameWorkbookElsewhere(roundId: string): Promise<SameWorkbook[]> {
  const [me] = await db
    .select({ hash: tcRounds.sourceHash, setId: tcRounds.setId, projectId: tcSets.projectId })
    .from(tcRounds)
    .innerJoin(tcSets, eq(tcSets.id, tcRounds.setId))
    .where(eq(tcRounds.id, roundId))
    .limit(1);
  if (!me?.hash) return [];
  const rows = await db
    .select({ issueId: jiraIssues.id, issueKey: jiraIssues.jiraKey, roundNo: tcRounds.roundNo })
    .from(tcRounds)
    .innerJoin(tcSets, eq(tcSets.id, tcRounds.setId))
    .innerJoin(jiraIssues, eq(jiraIssues.id, tcSets.issueId))
    .where(and(eq(tcRounds.sourceHash, me.hash), eq(tcSets.projectId, me.projectId), ne(tcSets.id, me.setId)))
    .orderBy(asc(jiraIssues.jiraKey), asc(tcRounds.roundNo));
  // One entry per item: the earliest round that used this exact file.
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.issueId) ? false : (seen.add(r.issueId), true)));
}

export type ScopeOverlap = { issueId: string; itemKey: string; roundNo: number; shared: number; sample: string[] };

/**
 * Other items of the same project that already review some of these test cases of the same Google Sheet, so the person can
 * be told before committing ("12 of these are also in CT-123"). Looks at each item's latest round only. A warning, never a
 * block: both items keep their own review, approvals and analytics. Excel workbooks have no shared identity to compare.
 */
export async function findScopeOverlaps(args: { issueId: string; projectId: string; spreadsheetId: string | null; tcKeys: string[] }): Promise<ScopeOverlap[]> {
  if (!args.spreadsheetId || args.tcKeys.length === 0) return [];
  const rows = await db
    .select({ issueId: jiraIssues.id, itemKey: jiraIssues.jiraKey, roundNo: tcRounds.roundNo, tcKey: tcCases.tcKey, rowNo: tcCases.rowNo })
    .from(tcCases)
    .innerJoin(tcRounds, eq(tcRounds.id, tcCases.roundId))
    .innerJoin(tcSets, eq(tcSets.id, tcRounds.setId))
    .innerJoin(jiraIssues, eq(jiraIssues.id, tcSets.issueId))
    .where(
      and(
        eq(tcSets.projectId, args.projectId),
        ne(tcSets.issueId, args.issueId),
        eq(tcRounds.spreadsheetId, args.spreadsheetId),
        sql`${tcRounds.roundNo} = (select max(r2.round_no) from tc_rounds r2 where r2.set_id = ${tcRounds.setId})`,
        inArray(tcCases.tcKey, args.tcKeys),
      ),
    )
    .orderBy(asc(tcCases.rowNo));
  const byItem = new Map<string, ScopeOverlap>();
  for (const r of rows) {
    const o = byItem.get(r.issueId) ?? { issueId: r.issueId, itemKey: r.itemKey, roundNo: r.roundNo, shared: 0, sample: [] };
    o.shared++;
    if (o.sample.length < 3) o.sample.push(`${r.tcKey.replace(/^.*?::/, "")} (row ${r.rowNo})`);
    byItem.set(r.issueId, o);
  }
  return [...byItem.values()].sort((a, b) => b.shared - a.shared || a.itemKey.localeCompare(b.itemKey));
}
