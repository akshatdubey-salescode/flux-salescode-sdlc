// Sign-off operations: who the issue's people are, committing a dev/tester
// sign-off against the approved round, and reading sign-offs back.

import { and, asc, count, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraIssues, jiraProjects, tcCases, tcFiles, tcResults, tcReviewComments, tcSignoffs } from "@/lib/db/schema";
import { getStore, XLSX_CONTENT_TYPE } from "@/lib/storage";
import { buildTcFileName, buildTcS3Key, istDateTime } from "./filenames";
import { resolveIssuePeople, type IssuePeople } from "./people";
import { contentHash } from "./content-hash";
import { BUSY_MESSAGE, isLockTimeout, lockItem } from "./concurrency";
import { getProjectFolder } from "./project-folder-service";
import { assertLatestRound, countOpenFeedback, freshReviewers, type RoundContext } from "./review-service";
import { RuleError } from "./rule-error";
import { matchSignoff, signoffProblem, type SignoffMatch } from "./signoff";
import { recomputeSafely } from "./stats-service";
import { canSignOff, roundStatusFrom, type Actor, type SignoffRole } from "./state";
import type { MultiParsed, TabGrid } from "./multi-tab";
import type { TcSource } from "./values";
import { buildSnapshotXlsx } from "./xlsx";

export async function getIssuePeople(issueId: string): Promise<IssuePeople> {
  const [row] = await db
    .select({
      assigneeEmail: jiraIssues.assigneeEmail,
      additional: jiraIssues.additionalAssigneeEmails,
      customFields: jiraIssues.customFields,
      devOwnerFieldIds: jiraProjects.devOwnerFieldIds,
      qaAssigneeFieldIds: jiraProjects.qaAssigneeFieldIds,
    })
    .from(jiraIssues)
    .innerJoin(jiraProjects, eq(jiraProjects.id, jiraIssues.projectId))
    .where(eq(jiraIssues.id, issueId))
    .limit(1);
  if (!row) return { dev: [], qa: [] };
  return resolveIssuePeople({
    assigneeEmail: row.assigneeEmail,
    additionalAssigneeEmails: row.additional,
    customFields: (row.customFields as Record<string, unknown> | null) ?? null,
    devOwnerFieldIds: row.devOwnerFieldIds,
    qaAssigneeFieldIds: row.qaAssigneeFieldIds,
  });
}

export type SignoffFailure = { ok: false; status: number; error: string };

export async function checkSignoffAllowed(args: {
  ctx: RoundContext;
  actor: Actor;
  role: SignoffRole;
}): Promise<{ ok: true; people: IssuePeople } | SignoffFailure> {
  const [people, openFeedback] = await Promise.all([getIssuePeople(args.ctx.issue.id), countOpenFeedback(args.ctx.roundId)]);
  const verdict = canSignOff({
    openFeedback,
    role: args.role,
    actor: args.actor,
    people,
    roundApproved: roundStatusFrom(args.ctx.reviewers.map((r) => r.state)) === "approved",
    isLatestRound: args.ctx.isLatest,
  });
  return verdict.ok ? { ok: true, people } : { ok: false, status: 403, error: verdict.reason };
}

export async function roundCaseRefs(roundId: string) {
  return db
    .select({ id: tcCases.id, tcKey: tcCases.tcKey, tcCode: tcCases.tcCode })
    .from(tcCases)
    .where(eq(tcCases.roundId, roundId))
    .orderBy(asc(tcCases.rowNo));
}

export type SignoffPreview = {
  role: SignoffRole;
  counts: SignoffMatch["counts"];
  total: number;
  unmatched: string[];
  missing: string[];
  meta: string;
  problem: string | null;
};

export async function previewSignoff(
  ctx: RoundContext,
  parsed: Extract<MultiParsed, { ok: true }>,
  role: SignoffRole,
): Promise<SignoffPreview> {
  const refs = await roundCaseRefs(ctx.roundId);
  const match = matchSignoff(refs, parsed.cases, role);
  return {
    role,
    counts: match.counts,
    total: refs.length,
    unmatched: match.unmatched,
    missing: match.missing,
    meta: match.meta,
    problem: signoffProblem(match, refs.length),
  };
}

export async function commitSignoff(args: {
  ctx: RoundContext;
  actor: { email: string; name: string | null };
  role: SignoffRole;
  source: TcSource;
  sheetUrl: string | null;
  spreadsheetId: string | null;
  /** Comma-separated tab titles that were read (the latest round's tabs). */
  tab: string;
  parsed: Extract<MultiParsed, { ok: true }>;
  grids: TabGrid[];
  notes: string | null;
}): Promise<{ ok: true; signoffId: string; fileName: string } | SignoffFailure> {
  const { ctx } = args;
  const refs = await roundCaseRefs(ctx.roundId);
  const match = matchSignoff(refs, args.parsed.cases, args.role);
  const problem = signoffProblem(match, refs.length);
  if (problem) return { ok: false, status: 400, error: problem };

  const parts = {
    kind: args.role === "dev" ? ("signoff_dev" as const) : ("signoff_tester" as const),
    round: ctx.roundNo,
    project: ctx.issue.projectName,
    jiraKey: ctx.issue.jiraKey,
    feature: ctx.issue.summary,
    user: args.actor.email,
    at: new Date(),
  };
  const fileName = buildTcFileName(parts);
  // Upload first (slow, outside the lock); the key is unique, and removed again if the sign-off is refused.
  const folder = await getProjectFolder({ id: ctx.issue.projectId, name: ctx.issue.projectName, key: ctx.issue.projectKey });
  const storageKey = buildTcS3Key({ ...parts, folder });
  const headerRows = new Map(args.parsed.tabs.map((t) => [t.title, t.headerRow]));
  const snapshot = await buildSnapshotXlsx({
    tabs: args.grids.map((g) => ({ title: g.title, grid: g.grid, headerRow: headerRows.get(g.title) ?? 1 })),
  });
  await getStore().put(storageKey, snapshot, XLSX_CONTENT_TYPE);

  const email = args.actor.email.trim().toLowerCase();
  let signoffId: string;
  try {
    signoffId = await db.transaction(async (tx) => {
      await lockItem(tx, ctx.issue.id);

      // The route checked all this before reading the sheet, which can take a while. Check again now that
      // nobody else can change the review: a resubmission, a change request or a new comment may have landed.
      await assertLatestRound(tx, ctx);
      if (roundStatusFrom((await freshReviewers(tx, ctx.roundId)).map((r) => r.state)) !== "approved") {
        throw new RuleError(409, "This round is no longer approved, so it can't be signed off. Reload the page.", "not_approved");
      }
      const [open] = await tx
        .select({ n: count() })
        .from(tcReviewComments)
        .where(and(eq(tcReviewComments.roundId, ctx.roundId), eq(tcReviewComments.kind, "comment"), eq(tcReviewComments.resolved, false)));
      if (Number(open?.n ?? 0) > 0) {
        throw new RuleError(409, "New feedback was added while you were submitting. Resolve or waive it before signing off.", "open_feedback");
      }

      const at = new Date();
      const [file] = await tx
        .insert(tcFiles)
        .values({
          setId: ctx.setId,
          kind: parts.kind,
          roundNo: ctx.roundNo,
          storageKey,
          fileName,
          sizeBytes: snapshot.length,
          uploadedBy: email,
          uploadedByName: args.actor.name,
          uploadedAt: at,
          contentHash: contentHash(args.grids),
        })
        .returning({ id: tcFiles.id });

      const [signoff] = await tx
        .insert(tcSignoffs)
        .values({
          setId: ctx.setId,
          roundId: ctx.roundId,
          role: args.role,
          source: args.source,
          sheetUrl: args.sheetUrl,
          spreadsheetId: args.spreadsheetId,
          sheetTab: args.tab,
          fileId: file.id,
          notes: args.notes,
          passCount: match.counts.pass,
          failCount: match.counts.fail,
          blockedCount: match.counts.blocked,
          notRunCount: match.counts.not_run,
          meta: match.meta,
          committedBy: email,
          committedByName: args.actor.name,
          committedAt: at,
        })
        .returning({ id: tcSignoffs.id });

      for (let i = 0; i < match.results.length; i += 200) {
        await tx.insert(tcResults).values(
          match.results.slice(i, i + 200).map((r) => ({ signoffId: signoff.id, caseId: r.caseId, result: r.result, remark: r.remark })),
        );
      }
      return signoff.id;
    });
  } catch (err) {
    await getStore().delete(storageKey).catch((e) => console.error("[test-cases] could not remove orphaned upload", storageKey, e));
    if (err instanceof RuleError) return { ok: false, status: err.status, error: err.message };
    if (isLockTimeout(err)) return { ok: false, status: 503, error: BUSY_MESSAGE };
    throw err;
  }

  await recomputeSafely(ctx.setId);
  return { ok: true, signoffId, fileName };
}

export type SignoffView = {
  id: string;
  role: SignoffRole;
  pass: number;
  fail: number;
  blocked: number;
  notRun: number;
  meta: string;
  notes: string | null;
  sheetUrl: string | null;
  fileId: string | null;
  fileName: string | null;
  by: string;
  label: string;
  /** The newest sign-off for its role — the one that counts. */
  current: boolean;
};

/** Every sign-off for a round, newest first; the newest per role is flagged current. */
export async function fetchSignoffs(roundId: string): Promise<SignoffView[]> {
  const rows = await db
    .select({ s: tcSignoffs, fileName: tcFiles.fileName })
    .from(tcSignoffs)
    .leftJoin(tcFiles, eq(tcFiles.id, tcSignoffs.fileId))
    .where(eq(tcSignoffs.roundId, roundId))
    .orderBy(desc(tcSignoffs.committedAt));
  const seen = new Set<string>();
  return rows.map(({ s, fileName }) => {
    const current = !seen.has(s.role);
    seen.add(s.role);
    return {
      id: s.id,
      role: s.role,
      pass: s.passCount,
      fail: s.failCount,
      blocked: s.blockedCount,
      notRun: s.notRunCount,
      meta: s.meta,
      notes: s.notes,
      sheetUrl: s.sheetUrl,
      fileId: s.fileId,
      fileName,
      by: s.committedByName ?? s.committedBy,
      label: istDateTime(s.committedAt),
      current,
    };
  });
}
