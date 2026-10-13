// Database + storage operations for Test Case submissions. Pure parsing,
// normalisation and naming live in the sibling modules; this file only wires
// them to Postgres and the blob store.

import { asc, desc, eq, inArray, sql } from "drizzle-orm";
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
import type { ParsedSheet } from "./template";
import { buildSnapshotXlsx } from "./xlsx";
import type { TcSource } from "./values";

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
  tab: string;
  parsed: Extract<ParsedSheet, { ok: true }>;
  grid: unknown[][];
  reviewers: { email: string; name: string | null }[];
  notes: string | null;
};

export type CommitResult = {
  setId: string;
  roundId: string;
  roundNo: number;
  fileId: string;
  fileName: string;
};

const CASE_CHUNK = 200;

export async function commitRound(args: CommitArgs): Promise<CommitResult> {
  const { issue, committer, parsed } = args;
  const at = new Date();

  // One set per issue; created on the first commit.
  await db
    .insert(tcSets)
    .values({
      issueId: issue.id,
      projectId: issue.projectId,
      createdBy: committer.email,
      createdByName: committer.name,
    })
    .onConflictDoNothing({ target: tcSets.issueId });
  const [set] = await db.select().from(tcSets).where(eq(tcSets.issueId, issue.id)).limit(1);

  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${tcRounds.roundNo}), 0) + 1` })
    .from(tcRounds)
    .where(eq(tcRounds.setId, set.id));
  const roundNo = Number(next);

  const nameParts = {
    kind: "testcases" as const,
    round: roundNo,
    project: issue.projectName,
    jiraKey: issue.jiraKey,
    feature: issue.summary,
    user: committer.email,
    at,
  };
  const fileName = buildTcFileName(nameParts);
  const storageKey = buildTcS3Key({ ...nameParts, projectKey: issue.projectKey });

  const snapshot = await buildSnapshotXlsx({
    tabTitle: args.tab,
    grid: args.grid,
    headerRow: parsed.headerRow,
  });
  await getStore().put(storageKey, snapshot, XLSX_CONTENT_TYPE);

  return db.transaction(async (tx) => {
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
        sheetTab: args.tab,
        snapshotFileId: file.id,
        notes: args.notes,
        tcCount: parsed.cases.length,
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
      args.reviewers.map((r) => ({ roundId: round.id, email: r.email, name: r.name })),
    );
    await tx.update(tcSets).set({ updatedAt: at }).where(eq(tcSets.id, set.id));

    return { setId: set.id, roundId: round.id, roundNo, fileId: file.id, fileName };
  });
}

/** Reviewers from the issue's latest round, to prefill the next submission. */
export async function previousReviewers(issueId: string): Promise<{ email: string; name: string | null }[]> {
  const [latest] = await db
    .select({ id: tcRounds.id })
    .from(tcRounds)
    .innerJoin(tcSets, eq(tcSets.id, tcRounds.setId))
    .where(eq(tcSets.issueId, issueId))
    .orderBy(desc(tcRounds.roundNo))
    .limit(1);
  if (!latest) return [];
  return db
    .select({ email: tcReviewers.email, name: tcReviewers.name })
    .from(tcReviewers)
    .where(eq(tcReviewers.roundId, latest.id))
    .orderBy(asc(tcReviewers.createdAt));
}

export type CaseView = {
  id: string;
  rowNo: number;
  tcCode: string;
  section: string | null;
  title: string;
  module: string | null;
  category: string;
  polarity: string | null;
  severity: string | null;
  priority: string | null;
  preconditions: string;
  steps: string;
  expected: string;
  devStatus: string;
  testerStatus: string;
  baReview: string;
};

export type RoundView = {
  id: string;
  roundNo: number;
  label: string;
  source: TcSource;
  sheetUrl: string | null;
  sheetTab: string | null;
  notes: string | null;
  tcCount: number;
  status: string;
  committedBy: string;
  committedByName: string | null;
  committedAt: string;
  snapshotFile: { id: string; fileName: string; sizeBytes: number } | null;
  reviewers: { email: string; name: string | null; state: string; decidedAt: string | null }[];
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
      notes: r.notes,
      tcCount: r.tcCount,
      status: r.status,
      committedBy: r.committedBy,
      committedByName: r.committedByName,
      committedAt: r.committedAt.toISOString(),
      snapshotFile: f ? { id: f.id, fileName: f.fileName, sizeBytes: f.sizeBytes } : null,
      reviewers: reviewers
        .filter((x) => x.roundId === r.id)
        .map((x) => ({ email: x.email, name: x.name, state: x.state, decidedAt: x.decidedAt?.toISOString() ?? null })),
    };
  });

  const selected = views.find((v) => v.roundNo === roundNo) ?? views[0];
  const cases = await db
    .select()
    .from(tcCases)
    .where(eq(tcCases.roundId, selected.id))
    .orderBy(asc(tcCases.rowNo));

  return {
    setId: set.id,
    rounds: views,
    selectedRoundNo: selected.roundNo,
    cases: cases.map((c) => ({
      id: c.id,
      rowNo: c.rowNo,
      tcCode: c.tcCode,
      section: c.section,
      title: c.title,
      module: c.module,
      category: c.category,
      polarity: c.polarity,
      severity: c.severity,
      priority: c.priority,
      preconditions: c.preconditions,
      steps: c.steps,
      expected: c.expected,
      devStatus: c.devStatus,
      testerStatus: c.testerStatus,
      baReview: c.baReview,
    })),
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
