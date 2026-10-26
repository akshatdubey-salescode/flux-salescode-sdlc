// Review operations: decisions, comments, resolving, and the reviewer-feedback
// workbook. Rules (who may do what, how status follows decisions) live in
// state.ts; this file applies them to Postgres and storage.

import { and, asc, count, desc, eq, inArray, max } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  jiraIssues,
  jiraProjects,
  tcCases,
  tcFiles,
  tcReviewComments,
  tcReviewers,
  tcRounds,
  tcSets,
} from "@/lib/db/schema";
import { getStore, XLSX_CONTENT_TYPE } from "@/lib/storage";
import { buildTcFileName, buildTcS3Key, istDateTime, roundLabel } from "./filenames";
import { buildFeedbackXlsx, type FeedbackRow } from "./feedback-xlsx";
import { BUSY_MESSAGE, isLockTimeout, lockItem, type Tx } from "./concurrency";
import { getProjectFolder } from "./project-folder-service";
import { RuleError } from "./rule-error";
import { describeScope, type RoundScope } from "./scope";
import { recomputeSafely } from "./stats-service";
import {
  canApprove,
  canComment,
  canDecide,
  canOverride,
  canResolve,
  planOverride,
  roundStatusFrom,
  validateCommentBody,
  validateDecision,
  validateOverrideReason,
  type Actor,
} from "./state";
import type { IssueRef } from "./service";
import type { TcCommentKind, TcReviewerState, TcRoundStatus } from "./values";

export type ReviewActor = Actor & { name: string | null };

export type RoundContext = {
  roundId: string;
  roundNo: number;
  setId: string;
  label: string;
  committedAt: Date;
  committerEmail: string;
  committerName: string | null;
  isLatest: boolean;
  issue: IssueRef;
  reviewers: { email: string; name: string | null; state: TcReviewerState }[];
  /** Which tabs and rows this round reviewed (null: every row of its tabs). */
  scope: RoundScope | null;
};

export type Failure = { ok: false; status: number; error: string };

export async function getRoundContext(roundId: string): Promise<RoundContext | null> {
  const [row] = await db
    .select({
      roundId: tcRounds.id,
      roundNo: tcRounds.roundNo,
      setId: tcRounds.setId,
      committedAt: tcRounds.committedAt,
      committedBy: tcRounds.committedBy,
      committedByName: tcRounds.committedByName,
      scope: tcRounds.scope,
      issueId: tcSets.issueId,
    })
    .from(tcRounds)
    .innerJoin(tcSets, eq(tcSets.id, tcRounds.setId))
    .where(eq(tcRounds.id, roundId))
    .limit(1);
  if (!row) return null;

  const [[issue], reviewers, [latest]] = await Promise.all([
    db
      .select({
        id: jiraIssues.id,
        jiraKey: jiraIssues.jiraKey,
        summary: jiraIssues.summary,
        issueType: jiraIssues.issueType,
        status: jiraIssues.status,
        projectId: jiraIssues.projectId,
        projectName: jiraProjects.name,
        projectKey: jiraProjects.jiraProjectKey,
        jiraBaseUrl: jiraProjects.jiraBaseUrl,
      })
      .from(jiraIssues)
      .innerJoin(jiraProjects, eq(jiraProjects.id, jiraIssues.projectId))
      .where(eq(jiraIssues.id, row.issueId))
      .limit(1),
    db
      .select({ email: tcReviewers.email, name: tcReviewers.name, state: tcReviewers.state })
      .from(tcReviewers)
      .where(eq(tcReviewers.roundId, roundId))
      .orderBy(asc(tcReviewers.createdAt)),
    db.select({ n: max(tcRounds.roundNo) }).from(tcRounds).where(eq(tcRounds.setId, row.setId)),
  ]);
  if (!issue) return null;

  return {
    roundId: row.roundId,
    roundNo: row.roundNo,
    setId: row.setId,
    label: roundLabel(row.roundNo, row.committedAt),
    committedAt: row.committedAt,
    committerEmail: row.committedBy,
    committerName: row.committedByName,
    isLatest: row.roundNo === (latest?.n ?? row.roundNo),
    issue,
    reviewers,
    scope: row.scope ?? null,
  };
}

async function caseBelongsToRound(caseId: string, roundId: string): Promise<boolean> {
  const [c] = await db
    .select({ id: tcCases.id })
    .from(tcCases)
    .where(and(eq(tcCases.id, caseId), eq(tcCases.roundId, roundId)))
    .limit(1);
  return !!c;
}

type TxReviewers = { email: string; name: string | null; state: TcReviewerState }[];

/** The round's reviewers as they are right now (inside the caller's transaction, so the rule is checked on fresh state). */
export async function freshReviewers(tx: Pick<typeof db, "select">, roundId: string): Promise<TxReviewers> {
  return tx
    .select({ email: tcReviewers.email, name: tcReviewers.name, state: tcReviewers.state })
    .from(tcReviewers)
    .where(eq(tcReviewers.roundId, roundId));
}

/** Under the item lock: the round being acted on must still be the newest one. */
export async function assertLatestRound(tx: Tx, ctx: RoundContext): Promise<void> {
  const [row] = await tx.select({ n: max(tcRounds.roundNo) }).from(tcRounds).where(eq(tcRounds.setId, ctx.setId));
  if ((row?.n ?? ctx.roundNo) !== ctx.roundNo) {
    throw new RuleError(409, "This round was just superseded by a newer submission. Reload the page.", "superseded");
  }
}

export async function recordDecision(args: {
  ctx: RoundContext;
  actor: ReviewActor;
  decision: string;
  comment: string;
}): Promise<{ ok: true; status: TcRoundStatus; feedbackFileId: string | null } | Failure> {
  const { ctx, actor } = args;
  const valid = validateDecision(args.decision, args.comment);
  if (!valid.ok) return { ok: false, status: 400, error: valid.reason };
  const verdict = canDecide(actor, ctx.reviewers, ctx.isLatest);
  if (!verdict.ok) return { ok: false, status: 403, error: verdict.reason };
  if (args.comment.length > 4000) return { ok: false, status: 400, error: "Comments are limited to 4000 characters." };

  const decision = args.decision as "approved" | "changes_requested";
  const email = actor.email.trim().toLowerCase();
  const now = new Date();

  let status: TcRoundStatus;
  try {
    status = await db.transaction(async (tx) => {
      await lockItem(tx, ctx.issue.id);
      await assertLatestRound(tx, ctx);
      // Approving is blocked while another reviewer's change request stands.
      if (decision === "approved") {
        const block = canApprove(actor, await freshReviewers(tx, ctx.roundId));
        if (!block.ok) throw new RuleError(403, block.reason);
      }

      // A listed reviewer's row is updated; an admin deciding without being
      // listed gets a row so the decision is visible like any other.
      await tx
        .insert(tcReviewers)
        .values({ roundId: ctx.roundId, email, name: actor.name, state: decision, decidedAt: now, decidedRoundNo: ctx.roundNo })
        .onConflictDoUpdate({
          target: [tcReviewers.roundId, tcReviewers.email],
          set: { state: decision, decidedAt: now, decidedRoundNo: ctx.roundNo },
        });
      await tx.insert(tcReviewComments).values({
        roundId: ctx.roundId,
        kind: decision,
        body: args.comment.trim(),
        authorEmail: email,
        authorName: actor.name,
      });
      const next = roundStatusFrom((await freshReviewers(tx, ctx.roundId)).map((r) => r.state));
      await tx.update(tcRounds).set({ status: next }).where(eq(tcRounds.id, ctx.roundId));
      await tx.update(tcSets).set({ updatedAt: now }).where(eq(tcSets.id, ctx.setId));
      return next;
    });
  } catch (err) {
    if (err instanceof RuleError) return { ok: false, status: err.status, error: err.message };
    if (isLockTimeout(err)) return { ok: false, status: 503, error: BUSY_MESSAGE };
    throw err;
  }

  await recomputeSafely(ctx.setId);

  // The stored feedback file is a record of this decision; failing to write it
  // must not undo the decision itself.
  let feedbackFileId: string | null = null;
  try {
    feedbackFileId = await storeFeedbackFile(ctx, actor);
  } catch (err) {
    console.error("[test-cases] could not store feedback file:", err);
  }
  return { ok: true, status, feedbackFileId };
}

/**
 * A reviewer ignores the open feedback and approves, with a reason. In one
 * transaction: standing change requests / waiting re-reviews become `overridden`,
 * unresolved comments are waived, the actor approves, and an `override` entry
 * records who did it, why and exactly what was waived (it shows in the history).
 */
export async function overrideAndApprove(args: {
  ctx: RoundContext;
  actor: ReviewActor;
  reason: unknown;
}): Promise<{ ok: true; status: TcRoundStatus; waivedComments: number; overriddenReviewers: string[]; feedbackFileId: string | null } | Failure> {
  const { ctx, actor } = args;
  const reason = validateOverrideReason(args.reason);
  if (!reason.ok) return { ok: false, status: 400, error: reason.reason };

  const email = actor.email.trim().toLowerCase();
  const now = new Date();

  let outcome: { status: TcRoundStatus; waivedComments: number; overridden: { email: string; name: string | null }[] };
  try {
    outcome = await db.transaction(async (tx) => {
      await lockItem(tx, ctx.issue.id);
      await assertLatestRound(tx, ctx);
      const reviewers = await freshReviewers(tx, ctx.roundId);
      const [open] = await tx
        .select({ n: count() })
        .from(tcReviewComments)
        .where(and(eq(tcReviewComments.roundId, ctx.roundId), eq(tcReviewComments.kind, "comment"), eq(tcReviewComments.resolved, false)));
      const standing = reviewers.some((r) => r.state === "changes_requested" || r.state === "re_review");
      const check = canOverride({ actor, reviewers, isLatestRound: ctx.isLatest, openFeedback: standing || Number(open?.n ?? 0) > 0 });
      if (!check.ok) throw new RuleError(check.reason.startsWith("There is no open") ? 409 : 403, check.reason);

      const plan = planOverride(reviewers, email);
      for (const [rEmail, state] of plan.states) {
        const touched = state === "overridden" || rEmail === email;
        await tx
          .insert(tcReviewers)
          .values({
            roundId: ctx.roundId,
            email: rEmail,
            name: rEmail === email ? actor.name : (reviewers.find((r) => r.email === rEmail)?.name ?? null),
            state,
            decidedAt: touched ? now : null,
            decidedRoundNo: touched ? ctx.roundNo : null,
          })
          .onConflictDoUpdate({
            target: [tcReviewers.roundId, tcReviewers.email],
            set: touched ? { state, decidedAt: now, decidedRoundNo: ctx.roundNo } : { state },
          });
      }

      const waived = await tx
        .update(tcReviewComments)
        .set({ resolved: true, waived: true, resolvedBy: email, resolvedAt: now })
        .where(and(eq(tcReviewComments.roundId, ctx.roundId), eq(tcReviewComments.kind, "comment"), eq(tcReviewComments.resolved, false)))
        .returning({ id: tcReviewComments.id });

      const overridden = plan.overridden.map((o) => ({ email: o, name: reviewers.find((r) => r.email === o)?.name ?? null }));
      await tx.insert(tcReviewComments).values({
        roundId: ctx.roundId,
        kind: "override",
        body: reason.reason,
        authorEmail: email,
        authorName: actor.name,
        meta: { overriddenReviewers: overridden, waivedComments: waived.length, roundNo: ctx.roundNo },
      });

      const next = roundStatusFrom([...plan.states.values()]);
      await tx.update(tcRounds).set({ status: next }).where(eq(tcRounds.id, ctx.roundId));
      await tx.update(tcSets).set({ updatedAt: now }).where(eq(tcSets.id, ctx.setId));
      return { status: next, waivedComments: waived.length, overridden };
    });
  } catch (err) {
    if (err instanceof RuleError) return { ok: false, status: err.status, error: err.message };
    if (isLockTimeout(err)) return { ok: false, status: 503, error: BUSY_MESSAGE };
    throw err;
  }

  await recomputeSafely(ctx.setId);

  let feedbackFileId: string | null = null;
  try {
    feedbackFileId = await storeFeedbackFile(ctx, actor);
  } catch (err) {
    console.error("[test-cases] could not store feedback file:", err);
  }
  return {
    ok: true,
    status: outcome.status,
    waivedComments: outcome.waivedComments,
    overriddenReviewers: outcome.overridden.map((o) => o.name ?? o.email),
    feedbackFileId,
  };
}

export async function addComment(args: {
  ctx: RoundContext;
  actor: ReviewActor;
  caseId: string | null;
  body: unknown;
}): Promise<{ ok: true; id: string } | Failure> {
  const { ctx, actor } = args;
  const verdict = canComment(actor, ctx.reviewers, ctx.committerEmail);
  if (!verdict.ok) return { ok: false, status: 403, error: verdict.reason };
  const body = validateCommentBody(args.body);
  if (!body.ok) return { ok: false, status: 400, error: body.reason };
  if (args.caseId && !(await caseBelongsToRound(args.caseId, ctx.roundId))) {
    return { ok: false, status: 400, error: "That test case is not part of this round." };
  }
  try {
    const id = await db.transaction(async (tx) => {
      // Serialised with decisions and overrides, so a comment can't slip in between an override waiving
      // the open feedback and its commit, and can't land on a round that was just superseded.
      await lockItem(tx, ctx.issue.id);
      await assertLatestRound(tx, ctx);
      const [row] = await tx
        .insert(tcReviewComments)
        .values({
          roundId: ctx.roundId,
          caseId: args.caseId,
          kind: "comment",
          body: body.body,
          authorEmail: actor.email.trim().toLowerCase(),
          authorName: actor.name,
        })
        .returning({ id: tcReviewComments.id });
      return row.id;
    });
    await recomputeSafely(ctx.setId);
    return { ok: true, id };
  } catch (err) {
    if (err instanceof RuleError) return { ok: false, status: err.status, error: err.message };
    if (isLockTimeout(err)) return { ok: false, status: 503, error: BUSY_MESSAGE };
    throw err;
  }
}

export async function setCommentResolved(args: {
  commentId: string;
  actor: ReviewActor;
  resolved: boolean;
}): Promise<{ ok: true; roundId: string } | Failure> {
  const [comment] = await db.select().from(tcReviewComments).where(eq(tcReviewComments.id, args.commentId)).limit(1);
  if (!comment) return { ok: false, status: 404, error: "Comment not found." };
  const ctx = await getRoundContext(comment.roundId);
  if (!ctx) return { ok: false, status: 404, error: "Round not found." };
  const verdict = canResolve(args.actor, comment.authorEmail, ctx.reviewers, ctx.committerEmail);
  if (!verdict.ok) return { ok: false, status: 403, error: verdict.reason };
  // Only a plain comment can be resolved: a decision or override entry is a record, not a to-do.
  if (comment.kind !== "comment") return { ok: false, status: 400, error: "Only comments can be resolved." };

  try {
    await db.transaction(async (tx) => {
      await lockItem(tx, ctx.issue.id);
      await assertLatestRound(tx, ctx);
      await tx
        .update(tcReviewComments)
        .set(
          args.resolved
            ? { resolved: true, waived: false, resolvedBy: args.actor.email.trim().toLowerCase(), resolvedAt: new Date() }
            : { resolved: false, waived: false, resolvedBy: null, resolvedAt: null },
        )
        .where(eq(tcReviewComments.id, args.commentId));
    });
  } catch (err) {
    if (err instanceof RuleError) return { ok: false, status: err.status, error: err.message };
    if (isLockTimeout(err)) return { ok: false, status: 503, error: BUSY_MESSAGE };
    throw err;
  }
  await recomputeSafely(ctx.setId);
  return { ok: true, roundId: comment.roundId };
}

/** Feedback comments on the round that nobody has resolved or waived yet. */
export async function countOpenFeedback(roundId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(tcReviewComments)
    .where(and(eq(tcReviewComments.roundId, roundId), eq(tcReviewComments.kind, "comment"), eq(tcReviewComments.resolved, false)));
  return Number(row?.n ?? 0);
}

export type FeedbackBundle = { buffer: Buffer; rows: FeedbackRow[] };

/** The round's feedback as a workbook, built from the live data. */
export async function buildFeedbackBundle(ctx: RoundContext): Promise<FeedbackBundle> {
  const [comments, cases, reviewers] = await Promise.all([
    db.select().from(tcReviewComments).where(eq(tcReviewComments.roundId, ctx.roundId)).orderBy(asc(tcReviewComments.createdAt)),
    db
      .select({ id: tcCases.id, tcCode: tcCases.tcCode, title: tcCases.title, section: tcCases.section, sheetTab: tcCases.sheetTab, rowNo: tcCases.rowNo })
      .from(tcCases)
      .where(eq(tcCases.roundId, ctx.roundId)),
    db
      .select({ email: tcReviewers.email, name: tcReviewers.name, state: tcReviewers.state, decidedAt: tcReviewers.decidedAt })
      .from(tcReviewers)
      .where(eq(tcReviewers.roundId, ctx.roundId))
      .orderBy(asc(tcReviewers.createdAt)),
  ]);
  const byId = new Map(cases.map((c) => [c.id, c]));

  const rows: FeedbackRow[] = comments.map((c) => {
    const tc = c.caseId ? byId.get(c.caseId) : undefined;
    return {
      scope: tc ? "Test case" : "Round",
      tab: tc?.sheetTab ? tc.sheetTab : null,
      row: tc?.rowNo ?? null,
      section: tc?.section ?? null,
      tcCode: tc?.tcCode ?? null,
      title: tc?.title ?? null,
      kind: c.kind as TcCommentKind,
      body: c.body,
      author: c.authorName ?? c.authorEmail,
      at: istDateTime(c.createdAt),
      resolved: c.resolved,
    };
  });

  const buffer = await buildFeedbackXlsx({
    issueKey: ctx.issue.jiraKey,
    issueSummary: ctx.issue.summary,
    roundLabel: ctx.label,
    generatedAt: istDateTime(new Date()),
    scopeText: describeScope(ctx.scope),
    reviewers: reviewers.map((r) => ({
      name: r.name,
      email: r.email,
      state: r.state,
      decidedAt: r.decidedAt ? istDateTime(r.decidedAt) : null,
    })),
    rows,
  });
  return { buffer, rows };
}

/** Saves a dated feedback workbook for the round (kept for later download) and returns its file id. */
export async function storeFeedbackFile(ctx: RoundContext, actor: ReviewActor): Promise<string> {
  const { buffer } = await buildFeedbackBundle(ctx);
  const at = new Date();
  const parts = {
    kind: "reviewer_feedback" as const,
    round: ctx.roundNo,
    project: ctx.issue.projectName,
    jiraKey: ctx.issue.jiraKey,
    feature: ctx.issue.summary,
    user: actor.email,
    at,
  };
  const fileName = buildTcFileName(parts);
  const folder = await getProjectFolder({ id: ctx.issue.projectId, name: ctx.issue.projectName, key: ctx.issue.projectKey });
  const storageKey = buildTcS3Key({ ...parts, folder });
  await getStore().put(storageKey, buffer, XLSX_CONTENT_TYPE);
  try {
    // The row is written under the item lock (the upload itself stays outside it), so an admin delete can't
    // slip between "list this item's files" and "delete the item" and leave this file untracked.
    return await db.transaction(async (tx) => {
      await lockItem(tx, ctx.issue.id);
      const [file] = await tx
        .insert(tcFiles)
        .values({
          setId: ctx.setId,
          kind: "reviewer_feedback",
          roundNo: ctx.roundNo,
          storageKey,
          fileName,
          sizeBytes: buffer.length,
          uploadedBy: actor.email.trim().toLowerCase(),
          uploadedByName: actor.name,
          uploadedAt: at,
        })
        .returning({ id: tcFiles.id });
      return file.id;
    });
  } catch (err) {
    // No row points at the file, so nothing could ever download or delete it: remove it now.
    await getStore().delete(storageKey).catch(() => undefined);
    throw err;
  }
}

export type CommentView = {
  id: string;
  caseId: string | null;
  kind: TcCommentKind;
  body: string;
  authorEmail: string;
  authorName: string | null;
  resolved: boolean;
  /** Resolved by an override rather than by being addressed. */
  waived: boolean;
  source: "reviewer" | "llm" | "system";
  /** AI findings: how serious and what kind. Null for people's comments. */
  severity: "high" | "medium" | "low" | null;
  category: string | null;
  /** The AI's note about a whole run (not a finding): shown as a record, never as something to resolve. */
  aiSummary: boolean;
  createdAt: string;
  createdLabel: string;
};

export async function fetchRoundComments(roundId: string): Promise<CommentView[]> {
  const rows = await db.select().from(tcReviewComments).where(eq(tcReviewComments.roundId, roundId)).orderBy(asc(tcReviewComments.createdAt));
  return rows.map((c) => ({
    id: c.id,
    caseId: c.caseId,
    kind: c.kind,
    body: c.body,
    authorEmail: c.authorEmail,
    authorName: c.authorName,
    resolved: c.resolved,
    waived: c.waived,
    source: c.source === "llm" || c.source === "system" ? c.source : "reviewer",
    severity: c.meta?.severity === "high" || c.meta?.severity === "medium" || c.meta?.severity === "low" ? c.meta.severity : null,
    category: typeof c.meta?.category === "string" ? c.meta.category : null,
    aiSummary: c.meta?.aiSummary === "true",
    createdAt: c.createdAt.toISOString(),
    createdLabel: istDateTime(c.createdAt),
  }));
}

export type FeedbackFileView = { id: string; fileName: string; sizeBytes: number; uploadedByName: string | null; label: string };

/** Stored feedback workbooks for every round of a set, newest first. */
export async function fetchFeedbackFiles(setId: string): Promise<Map<number, FeedbackFileView[]>> {
  const files = await db
    .select()
    .from(tcFiles)
    .where(and(eq(tcFiles.setId, setId), inArray(tcFiles.kind, ["reviewer_feedback"])))
    .orderBy(desc(tcFiles.uploadedAt));
  const out = new Map<number, FeedbackFileView[]>();
  for (const f of files) {
    const list = out.get(f.roundNo) ?? [];
    list.push({
      id: f.id,
      fileName: f.fileName,
      sizeBytes: f.sizeBytes,
      uploadedByName: f.uploadedByName,
      label: istDateTime(f.uploadedAt),
    });
    out.set(f.roundNo, list);
  }
  return out;
}
