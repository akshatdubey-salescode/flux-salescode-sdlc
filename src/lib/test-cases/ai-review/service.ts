// The AI review: starting a run, running it, and saving what it found.
//
// The AI sits in the round's reviewer list as a reserved reviewer (values.ts), so its findings block approval
// and sign-off through the same rules as a person's change request, and an override waives them.
//
// A run is two steps so the page never waits on the model: `startAiReview` records a `running` run (one per
// round at a time) and returns at once; `executeAiReview` does the slow work (after the response, see the
// routes) and saves everything in ONE locked transaction, or discards it if the round was superseded meanwhile.

import { and, asc, count, desc, eq, gt, lt, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraIssues, tcAiReviews, tcCases, tcReviewComments, tcReviewers, tcRounds, tcSets, tcSignoffs } from "@/lib/db/schema";
import { adfToText } from "@/lib/adf-to-text";
import { LlmError, callLlm, getLlmConfig, type LlmConfig } from "@/lib/llm/minimax";
import { isLockTimeout, lockItem } from "../concurrency";
import { RuleError } from "../rule-error";
import { assertLatestRound, freshReviewers, getRoundContext, type RoundContext } from "../review-service";
import { recomputeSafely } from "../stats-service";
import { getHealth, onHold, recordOutcome } from "./health";
import { aiStateAfterFailure, aiStateAfterRun, canComment, roundStatusFrom } from "../state";
import { AI_REVIEWER_EMAIL, AI_REVIEWER_NAME, type TcReviewerState } from "../values";
import { PROMPT_VERSION, REPORT_TOOL } from "./baseline";
import { chunkBySize } from "./chunk";
import { loadKnowledgeForRun, type UsedKnowledge } from "./knowledge";
import { extractReport, mergeReports, parseReport, type ReviewOutput } from "./parse";
import { describeScope } from "../scope";
import { TC_CATEGORY_LABELS } from "../values";
import { collectNonstandard, nonstandardMessage } from "../nonstandard";
import { buildSystem, buildUserPrompt, caseSize, makeLabeler, type PromptCase, type PromptHistoryEntry } from "./prompt";

export const MANUAL_COOLDOWN_MS = 60_000;
export const MAX_MANUAL_RUNS_PER_ROUND = 5;
/** A run still `running` after this long was lost with its server; it is closed so the round isn't held forever. */
export const STALE_RUN_MS = 10 * 60 * 1000;
const CALL_TIMEOUT_MS = 110_000;
const MAX_TOKENS = 24_000;
const PARALLEL_CALLS = 3;

export type AiRunView = {
  id: string;
  status: "running" | "succeeded" | "failed" | "superseded" | "skipped";
  trigger: "auto" | "manual";
  model: string;
  findingCount: number;
  summary: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  knowledge: UsedKnowledge[];
};

const toView = (r: typeof tcAiReviews.$inferSelect): AiRunView => ({
  id: r.id,
  status: r.status as AiRunView["status"],
  trigger: r.trigger as AiRunView["trigger"],
  model: r.model,
  findingCount: r.findingCount,
  summary: r.summary,
  error: r.error,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  knowledge: r.knowledge,
});

export type Failure = { ok: false; status: number; error: string };

// ---------------------------------------------------------------------------
// Saving the outcome (all under the item lock)
// ---------------------------------------------------------------------------

/** What a failed or lost run does to the round: release a hold on the AI reviewer, close the run. */
async function closeRunAsFailed(run: { id: string; roundId: string; setId: string }, message: string, status: "failed" | "superseded" = "failed") {
  try {
    const ctx = await getRoundContext(run.roundId);
    await db.transaction(async (tx) => {
      if (ctx) await lockItem(tx, ctx.issue.id);
      const [mine] = await tx.select({ state: tcReviewers.state }).from(tcReviewers).where(and(eq(tcReviewers.roundId, run.roundId), eq(tcReviewers.email, AI_REVIEWER_EMAIL))).limit(1);
      if (mine && status === "failed") {
        const next = aiStateAfterFailure(mine.state);
        if (next !== mine.state) {
          await tx.update(tcReviewers).set({ state: next }).where(and(eq(tcReviewers.roundId, run.roundId), eq(tcReviewers.email, AI_REVIEWER_EMAIL)));
          const all = await freshReviewers(tx, run.roundId);
          await tx.update(tcRounds).set({ status: roundStatusFrom(all.map((r) => r.state)) }).where(eq(tcRounds.id, run.roundId));
        }
      }
      await tx
        .update(tcAiReviews)
        .set({ status, error: message.slice(0, 500), finishedAt: new Date() })
        .where(and(eq(tcAiReviews.id, run.id), eq(tcAiReviews.status, "running")));
    });
    await recomputeSafely(run.setId);
  } catch (err) {
    console.error("[ai-review] could not close run", run.id, err);
    await db.update(tcAiReviews).set({ status, error: message.slice(0, 500), finishedAt: new Date() }).where(and(eq(tcAiReviews.id, run.id), eq(tcAiReviews.status, "running"))).catch(() => {});
  }
}

/** The AI couldn't even start (before any run exists): let people review without waiting on it. */
export async function releaseAiHold(roundId: string): Promise<void> {
  try {
    const ctx = await getRoundContext(roundId);
    if (!ctx) return;
    await db.transaction(async (tx) => {
      await lockItem(tx, ctx.issue.id);
      const [mine] = await tx.select({ state: tcReviewers.state }).from(tcReviewers).where(and(eq(tcReviewers.roundId, roundId), eq(tcReviewers.email, AI_REVIEWER_EMAIL))).limit(1);
      if (!mine || aiStateAfterFailure(mine.state) === mine.state) return;
      await tx.update(tcReviewers).set({ state: aiStateAfterFailure(mine.state) }).where(and(eq(tcReviewers.roundId, roundId), eq(tcReviewers.email, AI_REVIEWER_EMAIL)));
      const all = await freshReviewers(tx, roundId);
      await tx.update(tcRounds).set({ status: roundStatusFrom(all.map((r) => r.state)) }).where(eq(tcRounds.id, roundId));
    });
    await recomputeSafely(ctx.setId);
  } catch (err) {
    console.error("[ai-review] could not release the hold", roundId, err);
  }
}

/** Closes runs that were lost (server restarted mid-run) so they don't block the round or the next run. */
async function reapStaleRuns(roundId: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_RUN_MS);
  const stale = await db
    .select({ id: tcAiReviews.id, roundId: tcAiReviews.roundId, setId: tcAiReviews.setId })
    .from(tcAiReviews)
    .where(and(eq(tcAiReviews.roundId, roundId), eq(tcAiReviews.status, "running"), lt(tcAiReviews.startedAt, cutoff)));
  for (const run of stale) await closeRunAsFailed(run, "The AI review was interrupted. Run it again.");
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

/** The same non-standard-value finding was already resolved or waived on an earlier round of this item: do not raise it again. */
async function alreadyAccepted(setId: string, message: string): Promise<boolean> {
  const [hit] = await db
    .select({ id: tcReviewComments.id })
    .from(tcReviewComments)
    .innerJoin(tcRounds, eq(tcRounds.id, tcReviewComments.roundId))
    .where(
      and(
        eq(tcRounds.setId, setId),
        eq(tcReviewComments.source, "llm"),
        eq(tcReviewComments.resolved, true),
        eq(tcReviewComments.body, message),
        sql`${tcReviewComments.meta}->>'category' = 'nonstandard_value'`,
      ),
    )
    .limit(1);
  return !!hit;
}

async function saveOutcome(args: {
  run: { id: string; roundId: string; setId: string; startedAt: Date };
  ctx: RoundContext;
  output: ReviewOutput;
  refToCaseId: Map<string, string>;
  inputTokens: number;
  outputTokens: number;
  knowledge: UsedKnowledge[];
}): Promise<"saved" | "superseded"> {
  const { run, ctx, output } = args;
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await lockItem(tx, ctx.issue.id);
      await assertLatestRound(tx, ctx);

      const [still] = await tx.select({ status: tcAiReviews.status }).from(tcAiReviews).where(eq(tcAiReviews.id, run.id)).limit(1);
      if (still?.status !== "running") throw new RuleError(409, "This run was closed.", "run_closed");

      // A person overrode the AI while it was still working (the override is newer than this run's start): its
      // findings are kept, already waived, and the override stands. An override from before the run started was
      // about earlier findings; a run someone asked for afterwards raises fresh ones that block again.
      const [mine] = await tx
        .select({ state: tcReviewers.state, decidedAt: tcReviewers.decidedAt })
        .from(tcReviewers)
        .where(and(eq(tcReviewers.roundId, ctx.roundId), eq(tcReviewers.email, AI_REVIEWER_EMAIL)))
        .limit(1);
      const overridden = mine?.state === "overridden" && !!mine.decidedAt && mine.decidedAt.getTime() >= run.startedAt.getTime();

      // A re-run replaces the AI's own still-open findings on this round; resolved or waived ones stay as history.
      await tx
        .delete(tcReviewComments)
        .where(
          and(
            eq(tcReviewComments.roundId, ctx.roundId),
            eq(tcReviewComments.source, "llm"),
            eq(tcReviewComments.kind, "comment"),
            eq(tcReviewComments.resolved, false),
            sql`${tcReviewComments.meta}->>'aiFinding' = 'true'`,
          ),
        );

      const author = { authorEmail: AI_REVIEWER_EMAIL, authorName: AI_REVIEWER_NAME, source: "llm" };
      const waivedNote = overridden ? { resolved: true, waived: true, resolvedBy: AI_REVIEWER_EMAIL, resolvedAt: now } : {};
      const count = output.findings.length;
      const summaryText = output.summary || (count > 0 ? `${count} finding${count === 1 ? "" : "s"}.` : "No issues found.");
      // Explicit, increasing timestamps: now() is the same for every row of a transaction, which would leave the
      // thread order to chance. The run's summary comes first, then the findings from most to least serious.
      await tx.insert(tcReviewComments).values({
        roundId: ctx.roundId,
        // A change request when there are findings (like a person's); otherwise a neutral, already-closed note: the AI never approves.
        kind: count > 0 && !overridden ? "changes_requested" : "comment",
        body: summaryText,
        ...author,
        ...(count > 0 && !overridden ? {} : { resolved: true }),
        meta: { aiSummary: "true", runId: run.id, findingCount: count, coverageNotes: output.coverageNotes || null },
        createdAt: now,
      });
      for (let i = 0; i < output.findings.length; i += 100) {
        await tx.insert(tcReviewComments).values(
          output.findings.slice(i, i + 100).map((f, j) => ({
            roundId: ctx.roundId,
            caseId: f.caseRef ? (args.refToCaseId.get(f.caseRef) ?? null) : null,
            kind: "comment" as const,
            body: f.message,
            ...author,
            ...waivedNote,
            meta: { aiFinding: "true", severity: f.severity, category: f.category, runId: run.id },
            createdAt: new Date(now.getTime() + 1 + i + j),
          })),
        );
      }

      const state: TcReviewerState = overridden ? "overridden" : aiStateAfterRun(count);
      await tx
        .insert(tcReviewers)
        .values({
          roundId: ctx.roundId,
          email: AI_REVIEWER_EMAIL,
          name: AI_REVIEWER_NAME,
          state,
          decidedAt: state === "changes_requested" ? now : null,
          decidedRoundNo: state === "changes_requested" ? ctx.roundNo : null,
        })
        .onConflictDoUpdate({
          target: [tcReviewers.roundId, tcReviewers.email],
          set: overridden ? {} : { state, decidedAt: state === "changes_requested" ? now : null, decidedRoundNo: state === "changes_requested" ? ctx.roundNo : null },
        });

      const next = roundStatusFrom((await freshReviewers(tx, ctx.roundId)).map((r) => r.state));
      await tx.update(tcRounds).set({ status: next }).where(eq(tcRounds.id, ctx.roundId));
      await tx.update(tcSets).set({ updatedAt: now }).where(eq(tcSets.id, ctx.setId));
      await tx
        .update(tcAiReviews)
        .set({
          status: "succeeded",
          findingCount: count,
          summary: summaryText,
          inputTokens: args.inputTokens,
          outputTokens: args.outputTokens,
          knowledge: args.knowledge,
          finishedAt: now,
        })
        .where(eq(tcAiReviews.id, run.id));
    });
  } catch (err) {
    if (err instanceof RuleError && err.code === "superseded") return "superseded";
    throw err;
  }
  await recomputeSafely(run.setId);
  return "saved";
}

// ---------------------------------------------------------------------------
// Starting a run
// ---------------------------------------------------------------------------

export async function startAiReview(args: {
  roundId: string;
  trigger: "auto" | "manual";
  requestedBy: string | null;
  /** For manual runs: who is asking (checked against the round's people). */
  actor?: { email: string; isAdmin: boolean };
  /** An admin re-running reviews that were skipped: try the service even if it is marked on hold. */
  ignoreHold?: boolean;
}): Promise<{ ok: true; run: AiRunView; started: boolean } | Failure> {
  const cfg = getLlmConfig();
  if (!cfg) return { ok: false, status: 404, error: "The AI review is not enabled." };
  const ctx = await getRoundContext(args.roundId);
  if (!ctx) return { ok: false, status: 404, error: "Round not found." };
  if (!ctx.isLatest) return { ok: false, status: 409, error: "This round has been superseded by a newer one." };

  if (args.trigger === "manual") {
    if (!args.actor) return { ok: false, status: 403, error: "Sign in to run the AI review." };
    const verdict = canComment(args.actor, ctx.reviewers, ctx.committerEmail);
    if (!verdict.ok) return { ok: false, status: 403, error: "Only the reviewers and the submitter can run the AI review." };
    const [signed] = await db.select({ n: count() }).from(tcSignoffs).where(eq(tcSignoffs.roundId, ctx.roundId));
    if (Number(signed?.n ?? 0) > 0) {
      return { ok: false, status: 409, error: "Sign-off has started on this round, so the AI review can't change it any more. Submit a new round to run it again." };
    }
  }

  await reapStaleRuns(ctx.roundId);

  const [running] = await db.select().from(tcAiReviews).where(and(eq(tcAiReviews.roundId, ctx.roundId), eq(tcAiReviews.status, "running"))).limit(1);
  if (running) return { ok: true, run: toView(running), started: false };

  // The service is known to be unusable (quota used up, key rejected): don't attempt an automatic review, record
  // that it was skipped and why, and let people review without it. A manual run still tries, which also tells us
  // when the service is back.
  if (args.trigger === "auto" && !args.ignoreHold) {
    const health = await getHealth();
    if (onHold(health, new Date())) {
      const [skipped] = await db
        .insert(tcAiReviews)
        .values({
          roundId: ctx.roundId,
          setId: ctx.setId,
          status: "skipped",
          trigger: "auto",
          requestedBy: args.requestedBy,
          model: cfg.model,
          promptVersion: PROMPT_VERSION,
          error: `On hold: ${health.message ?? "the AI service is unavailable"}. It will not run automatically until the service recovers; use Run AI review to try again.`.slice(0, 500),
          finishedAt: new Date(),
        })
        .returning();
      await releaseAiHold(ctx.roundId);
      return { ok: true, run: toView(skipped), started: false };
    }
  }

  if (args.trigger === "manual") {
    const since = new Date(Date.now() - MANUAL_COOLDOWN_MS);
    const [recent] = await db.select({ id: tcAiReviews.id }).from(tcAiReviews).where(and(eq(tcAiReviews.roundId, ctx.roundId), ne(tcAiReviews.status, "skipped"), gt(tcAiReviews.startedAt, since))).limit(1);
    if (recent) return { ok: false, status: 429, error: "The AI review just ran. Wait a minute before running it again." };
    const [manual] = await db.select({ n: count() }).from(tcAiReviews).where(and(eq(tcAiReviews.roundId, ctx.roundId), eq(tcAiReviews.trigger, "manual")));
    if (Number(manual?.n ?? 0) >= MAX_MANUAL_RUNS_PER_ROUND) {
      return { ok: false, status: 429, error: `The AI review has been run ${MAX_MANUAL_RUNS_PER_ROUND} times on this round. Resubmit to run it again.` };
    }
  }

  try {
    const [row] = await db
      .insert(tcAiReviews)
      .values({
        roundId: ctx.roundId,
        setId: ctx.setId,
        status: "running",
        trigger: args.trigger,
        requestedBy: args.requestedBy,
        model: cfg.model,
        promptVersion: PROMPT_VERSION,
      })
      .returning();
    return { ok: true, run: toView(row), started: true };
  } catch (err) {
    // Lost the race to another request: the unique index allows one running run per round. Return that one.
    const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") {
      const [other] = await db.select().from(tcAiReviews).where(and(eq(tcAiReviews.roundId, ctx.roundId), eq(tcAiReviews.status, "running"))).limit(1);
      if (other) return { ok: true, run: toView(other), started: false };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Gathering the input
// ---------------------------------------------------------------------------

async function loadHistory(ctx: RoundContext): Promise<PromptHistoryEntry[]> {
  const [rounds, comments] = await Promise.all([
    db
      .select({ roundNo: tcRounds.roundNo, by: tcRounds.committedBy, notes: tcRounds.notes })
      .from(tcRounds)
      .where(eq(tcRounds.setId, ctx.setId))
      .orderBy(asc(tcRounds.roundNo)),
    db
      .select({ c: tcReviewComments, roundNo: tcRounds.roundNo, caseKey: tcCases.tcKey })
      .from(tcReviewComments)
      .innerJoin(tcRounds, eq(tcRounds.id, tcReviewComments.roundId))
      .leftJoin(tcCases, eq(tcCases.id, tcReviewComments.caseId))
      .where(eq(tcRounds.setId, ctx.setId))
      .orderBy(asc(tcReviewComments.createdAt)),
  ]);
  const label = makeLabeler(rounds.map((r) => r.by));
  const entries: (PromptHistoryEntry & { at: number })[] = [];
  for (const r of rounds) {
    entries.push({ at: 0, roundNo: r.roundNo, who: label(r.by), kind: "submitted", body: r.notes ?? "", caseRef: null, status: null });
  }
  for (const { c, roundNo, caseKey } of comments) {
    // This round's own still-open AI findings, and the AI's notes about earlier runs on this round, are about to be
    // replaced by this run's; showing them as history makes the model think they came from an earlier round.
    if (c.roundId === ctx.roundId && c.source === "llm" && ((c.kind === "comment" && !c.resolved && c.meta?.aiFinding === "true") || c.meta?.aiSummary === "true")) continue;
    entries.push({
      at: c.createdAt.getTime(),
      roundNo,
      who: label(c.authorEmail),
      kind: c.kind,
      body: c.body,
      caseRef: caseKey ?? null,
      status: c.kind === "comment" ? (c.waived ? "waived" : c.resolved ? "resolved" : "open") : null,
    });
  }
  // Rounds first within a round number (submission), then comments in time order.
  const first = (e: { kind: string }) => (e.kind === "submitted" ? 0 : 1);
  return entries.sort((a, b) => a.roundNo - b.roundNo || first(a) - first(b) || a.at - b.at).map((e) => ({ roundNo: e.roundNo, who: e.who, kind: e.kind, body: e.body, caseRef: e.caseRef, status: e.status }));
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

async function reviewChunk(args: { cfg: LlmConfig; system: string; user: string; knownRefs: ReadonlySet<string> }) {
  const call = (force: boolean) =>
    callLlm(
      {
        system: args.system,
        messages: [{ role: "user", content: args.user }],
        maxTokens: MAX_TOKENS,
        tools: [REPORT_TOOL as unknown as { name: string; description: string; input_schema: Record<string, unknown> }],
        forceTool: force ? REPORT_TOOL.name : undefined,
        timeoutMs: CALL_TIMEOUT_MS,
      },
      args.cfg,
    );
  let res;
  try {
    res = await call(true);
  } catch (err) {
    // Some models refuse a forced tool call while thinking; the tool is still offered and the answer parsed the same way.
    if (err instanceof LlmError && err.code === "bad_request" && /tool_choice|tool choice|thinking/i.test(err.message)) res = await call(false);
    else throw err;
  }
  const report = parseReport(extractReport(res.blocks), args.knownRefs);
  if (!report) throw new LlmError("The AI's answer could not be read.", "empty");
  return { report, inputTokens: res.inputTokens, outputTokens: res.outputTokens };
}

/** Runs the review for a started run and saves the outcome. Never throws: every failure closes the run. */
export async function executeAiReview(runId: string): Promise<void> {
  const [run] = await db.select().from(tcAiReviews).where(eq(tcAiReviews.id, runId)).limit(1);
  if (!run || run.status !== "running") return;
  const cfg = getLlmConfig();
  if (!cfg) return closeRunAsFailed(run, "The AI review is not enabled.");

  try {
    const ctx = await getRoundContext(run.roundId);
    if (!ctx) return closeRunAsFailed(run, "Round not found.");

    const [issue] = await db
      .select({ description: jiraIssues.description })
      .from(jiraIssues)
      .where(eq(jiraIssues.id, ctx.issue.id))
      .limit(1);
    const caseRows = await db.select().from(tcCases).where(eq(tcCases.roundId, ctx.roundId)).orderBy(asc(tcCases.rowNo));
    if (caseRows.length === 0) return closeRunAsFailed(run, "This round has no test cases to review.");

    const cases: (PromptCase & { size: number })[] = caseRows.map((r) => {
      const c: PromptCase = {
        ref: r.tcKey,
        tab: r.sheetTab,
        row: r.rowNo,
        title: r.title,
        module: r.module,
        polarity: r.polarity,
        // The label people see ('Offline / Sync'), not the stored value ('offline_sync').
        category: TC_CATEGORY_LABELS[r.category] ?? r.category,
        priority: r.priority,
        preconditions: r.preconditions,
        steps: r.steps,
        expected: r.expected,
      };
      return { ...c, size: caseSize(c) };
    });
    // Values the sheet uses that are not on the standard lists (a TC type nobody mapped, an odd status word): reported by
    // Flux itself as one finding, so it never depends on the model noticing. The model is told, to avoid repeating it.
    const nonstandard = collectNonstandard(caseRows.map((r) => r.raw));
    const nonstandardLines = nonstandard.slice(0, 12).map((v) => `${v.field}: "${v.value}" × ${v.count}`);
    const nonstandardText = nonstandardLines.length > 0 ? nonstandardLines.join("\n") : null;
    const refToCaseId = new Map(caseRows.map((r) => [r.tcKey, r.id]));
    const knownRefs = new Set(refToCaseId.keys());

    const [history, knowledge] = await Promise.all([loadHistory(ctx), loadKnowledgeForRun(ctx.issue.projectId)]);
    const system = buildSystem(knowledge.docs);
    const promptIssue = { key: ctx.issue.jiraKey, type: ctx.issue.issueType, summary: ctx.issue.summary, description: adfToText(issue?.description) };

    const chunks = chunkBySize(cases);
    const results: Awaited<ReturnType<typeof reviewChunk>>[] = new Array(chunks.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL_CALLS, chunks.length) }, async () => {
        while (next < chunks.length) {
          const i = next++;
          const user = buildUserPrompt({ issue: promptIssue, roundNo: ctx.roundNo, allCases: cases, cases: chunks[i], history, part: { index: i + 1, total: chunks.length }, scopeText: ctx.scope ? describeScope(ctx.scope) : null, nonstandardText });
          results[i] = await reviewChunk({ cfg, system, user, knownRefs });
        }
      }),
    );

    const output = mergeReports(results.map((r) => r.report));
    const nsMessage = nonstandardMessage(nonstandard, caseRows.length);
    if (nsMessage && !(await alreadyAccepted(ctx.setId, nsMessage))) {
      const affected = nonstandard.reduce((n, v) => n + v.count, 0);
      // Many odd values (a quarter of the cases or more) is a medium problem; a few stray ones are minor.
      output.findings.push({ caseRef: null, severity: affected * 4 >= caseRows.length ? "medium" : "low", category: "nonstandard_value", message: nsMessage });
      output.findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    }
    const outcome = await saveOutcome({
      run,
      ctx,
      output,
      refToCaseId,
      inputTokens: results.reduce((n, r) => n + r.inputTokens, 0),
      outputTokens: results.reduce((n, r) => n + r.outputTokens, 0),
      knowledge: knowledge.used,
    });
    await recordOutcome({ ok: true });
    if (outcome === "superseded") await closeRunAsFailed(run, "A newer round was submitted while this ran, so the result was discarded.", "superseded");
  } catch (err) {
    if (err instanceof LlmError) await recordOutcome({ ok: false, code: err.code, message: err.message });
    const message =
      err instanceof LlmError ? err.message
      : isLockTimeout(err) ? "The item was busy. Run the AI review again."
      : err instanceof RuleError ? err.message
      : "The AI review failed. Run it again.";
    if (!(err instanceof LlmError) && !(err instanceof RuleError)) console.error("[ai-review] run failed", runId, err);
    await closeRunAsFailed(run, message);
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The newest run for a round (stale ones are closed first), for the page and the status endpoint. */
export async function getLatestAiRun(roundId: string): Promise<AiRunView | null> {
  await reapStaleRuns(roundId);
  const [row] = await db.select().from(tcAiReviews).where(eq(tcAiReviews.roundId, roundId)).orderBy(desc(tcAiReviews.startedAt)).limit(1);
  return row ? toView(row) : null;
}

/** Counts used by the panel to explain why Run is unavailable. */
export async function manualRunsLeft(roundId: string): Promise<{ used: number; max: number; cooldownUntil: string | null }> {
  const [manual] = await db.select({ n: count() }).from(tcAiReviews).where(and(eq(tcAiReviews.roundId, roundId), eq(tcAiReviews.trigger, "manual")));
  // A skipped run never called the service, so it neither starts a cooldown nor uses up a manual run.
  const [last] = await db.select({ at: tcAiReviews.startedAt }).from(tcAiReviews).where(and(eq(tcAiReviews.roundId, roundId), ne(tcAiReviews.status, "skipped"))).orderBy(desc(tcAiReviews.startedAt)).limit(1);
  const until = last ? new Date(last.at.getTime() + MANUAL_COOLDOWN_MS) : null;
  return { used: Number(manual?.n ?? 0), max: MAX_MANUAL_RUNS_PER_ROUND, cooldownUntil: until && until.getTime() > Date.now() ? until.toISOString() : null };
}


/** Everything the review panel's AI block needs for one round, or null when the AI review is switched off. */
export async function loadAiPanel(args: {
  roundId: string;
  isLatest: boolean;
  actor: { email: string; isAdmin: boolean };
  reviewers: { email: string }[];
  committerEmail: string;
  signoffCount: number;
}) {
  if (!getLlmConfig()) return null;
  const [run, limits] = await Promise.all([getLatestAiRun(args.roundId), manualRunsLeft(args.roundId)]);
  const participant = canComment(args.actor, args.reviewers, args.committerEmail).ok;
  const blockedReason = !participant
    ? "Only the reviewers and the submitter can run the AI review."
    : !args.isLatest
      ? "Only the latest round can be reviewed again. Open the latest round."
      : args.signoffCount > 0
        ? "Sign-off has started on this round, so the AI review can't change it any more."
        : null;
  return { run, limits, canRun: participant, blockedReason };
}

// ---------------------------------------------------------------------------
// Re-running what was skipped while the service was unavailable
// ---------------------------------------------------------------------------

/** Latest rounds (no sign-off yet) whose newest AI run was skipped or failed: reviews people are missing. */
async function roundsNeedingReview(limit: number): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    select r.id
    from tc_rounds r
    where r.round_no = (select max(x.round_no) from tc_rounds x where x.set_id = r.set_id)
      and (select a.status from tc_ai_reviews a where a.round_id = r.id order by a.started_at desc limit 1) in ('skipped', 'failed')
      and not exists (select 1 from tc_signoffs s where s.round_id = r.id)
    order by r.committed_at desc
    limit ${limit}`);
  return rows.rows.map((r) => r.id);
}

export async function countRoundsNeedingReview(): Promise<number> {
  return (await roundsNeedingReview(500)).length;
}

/** Starts a review for each such round, a few at a time. Meant to run after the response (see the route). */
export async function rerunSkippedReviews(requestedBy: string, limit = 25): Promise<{ started: number }> {
  const ids = await roundsNeedingReview(limit);
  let started = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(2, ids.length) }, async () => {
      while (next < ids.length) {
        const roundId = ids[next++];
        try {
          const st = await startAiReview({ roundId, trigger: "auto", requestedBy, ignoreHold: true });
          if (st.ok && st.started) {
            started++;
            await executeAiReview(st.run.id);
          }
        } catch (err) {
          console.error("[ai-review] re-run failed for round", roundId, err);
        }
        // If the service went back on hold during this batch, stop spending calls on it.
        if (onHold(await getHealth(), new Date())) next = ids.length;
      }
    }),
  );
  return { started };
}
