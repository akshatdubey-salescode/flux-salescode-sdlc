// Whether the AI service is usable, and what to do about it. The state machine is pure (`nextHealth`) so it can be
// tested; the rest reads and writes the single tc_ai_status row.

import { eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { tcAiReviews, tcAiStatus } from "@/lib/db/schema";
import { LlmError, callLlm, getLlmConfig, isServiceProblem, type LlmErrorCode } from "@/lib/llm/minimax";
import { buildAiAlertEmail, sendEmail } from "../notify";

export type AiHealthState = "ok" | "degraded" | "paused";
export type AiHealthReason = "quota" | "auth" | "rate_limited" | "unavailable";

export type HealthRow = {
  state: AiHealthState;
  reason: AiHealthReason | null;
  message: string | null;
  failureStreak: number;
  since: Date;
  lastOkAt: Date | null;
  lastFailureAt: Date | null;
  retryAt: Date | null;
};

/** How long automatic reviews skip the service after a quota/key failure before one may probe it again. */
export const PAUSE_RETRY_MS = 15 * 60 * 1000;
/** Consecutive transient failures before the service is shown as having trouble. */
export const DEGRADED_AFTER = 3;

export const EMPTY_HEALTH: HealthRow = { state: "ok", reason: null, message: null, failureStreak: 0, since: new Date(0), lastOkAt: null, lastFailureAt: null, retryAt: null };

const reasonOf = (code: LlmErrorCode): AiHealthReason => (code === "quota" ? "quota" : code === "auth" ? "auth" : code === "rate_limited" ? "rate_limited" : "unavailable");

export type Outcome = { ok: true } | { ok: false; code: LlmErrorCode; message: string };

/**
 * The next health after a run. Success always returns to ok. A quota or rejected key pauses at once (nothing a retry
 * would fix). Other service problems count up and show as degraded after DEGRADED_AFTER in a row. A failure that
 * isn't about the service (a bad answer, an empty reply) changes nothing.
 */
export function nextHealth(prev: HealthRow, outcome: Outcome, now: Date): HealthRow {
  if (outcome.ok) {
    return { ...EMPTY_HEALTH, since: prev.state === "ok" ? prev.since : now, lastOkAt: now };
  }
  if (!isServiceProblem(outcome.code)) return prev;
  const base = { lastOkAt: prev.lastOkAt, lastFailureAt: now, message: outcome.message.slice(0, 300) };
  if (outcome.code === "quota" || outcome.code === "auth") {
    return { ...base, state: "paused", reason: reasonOf(outcome.code), failureStreak: prev.failureStreak + 1, since: prev.state === "paused" && prev.reason === reasonOf(outcome.code) ? prev.since : now, retryAt: new Date(now.getTime() + PAUSE_RETRY_MS) };
  }
  const streak = prev.failureStreak + 1;
  if (prev.state === "paused") return { ...prev, ...base, failureStreak: streak, retryAt: new Date(now.getTime() + PAUSE_RETRY_MS) };
  return { ...base, state: streak >= DEGRADED_AFTER ? "degraded" : "ok", reason: streak >= DEGRADED_AFTER ? reasonOf(outcome.code) : null, failureStreak: streak, since: prev.state === "degraded" ? prev.since : streak >= DEGRADED_AFTER ? now : prev.since, retryAt: null };
}

/** Whether automatic reviews should skip calling the service right now. */
export function onHold(h: Pick<HealthRow, "state" | "retryAt">, now: Date): boolean {
  return h.state === "paused" && !!h.retryAt && h.retryAt.getTime() > now.getTime();
}

export async function getHealth(): Promise<HealthRow> {
  const [row] = await db.select().from(tcAiStatus).where(eq(tcAiStatus.id, "minimax")).limit(1);
  if (!row) return EMPTY_HEALTH;
  return { state: row.state as AiHealthState, reason: row.reason as AiHealthReason | null, message: row.message, failureStreak: row.failureStreak, since: row.since, lastOkAt: row.lastOkAt, lastFailureAt: row.lastFailureAt, retryAt: row.retryAt };
}

async function save(h: HealthRow) {
  const values = { id: "minimax", state: h.state, reason: h.reason, message: h.message, failureStreak: h.failureStreak, since: h.since, lastOkAt: h.lastOkAt, lastFailureAt: h.lastFailureAt, retryAt: h.retryAt, updatedAt: new Date() };
  await db.insert(tcAiStatus).values(values).onConflictDoUpdate({ target: tcAiStatus.id, set: values });
}

/** Records how a call to the service went. Never throws: health tracking must not break a review. */
export async function recordOutcome(outcome: Outcome): Promise<void> {
  try {
    const prev = await getHealth();
    const now = new Date();
    const next = nextHealth(prev, outcome, now);
    if (next === prev) return;
    await save(next);
    if (next.state !== "ok" && (prev.state !== next.state || prev.reason !== next.reason)) await alertAdmins(next);
  } catch (err) {
    console.error("[ai-review] could not record AI health", err);
  }
}

/** Emails the addresses in AI_ALERT_EMAILS (comma separated) when the service goes on hold. Off unless that is set. */
async function alertAdmins(h: HealthRow): Promise<void> {
  const to = (process.env.AI_ALERT_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  if (to.length === 0) return;
  const sent = await sendEmail(to, buildAiAlertEmail({ state: h.state, reason: h.reason, message: h.message }));
  if (!sent.ok) console.warn("[ai-review] AI alert email not sent:", sent.error);
}

/** A tiny real call, to see whether the service answers now (the admin's "Check now"). */
export async function probe(): Promise<HealthRow> {
  if (!getLlmConfig()) return getHealth();
  try {
    await callLlm({ system: "Reply with one word.", messages: [{ role: "user", content: "ping" }], maxTokens: 400, timeoutMs: 30_000 });
    await recordOutcome({ ok: true });
  } catch (err) {
    if (err instanceof LlmError) await recordOutcome({ ok: false, code: err.code, message: err.message });
    else await recordOutcome({ ok: false, code: "network", message: "Could not reach the AI service." });
  }
  return getHealth();
}

/** Tokens used by AI reviews in the last 24 hours, to show how close the plan might be. */
export async function usageLast24h(): Promise<{ runs: number; inputTokens: number; outputTokens: number }> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const rows = await db
    .select({ status: tcAiReviews.status, i: tcAiReviews.inputTokens, o: tcAiReviews.outputTokens })
    .from(tcAiReviews)
    .where(gte(tcAiReviews.startedAt, since));
  const done = rows.filter((r) => r.status === "succeeded");
  return { runs: rows.length, inputTokens: done.reduce((n, r) => n + r.i, 0), outputTokens: done.reduce((n, r) => n + r.o, 0) };
}

export type AiBanner = {
  state: "degraded" | "paused";
  reason: AiHealthReason | null;
  /** The provider's own wording; admins only. */
  detail: string | null;
  since: string;
};

/** What the pages show everyone: null when the AI review is off or healthy. */
export async function loadAiBanner(isAdmin: boolean): Promise<AiBanner | null> {
  if (!getLlmConfig()) return null;
  const h = await getHealth();
  if (h.state === "ok") return null;
  return { state: h.state, reason: h.reason, detail: isAdmin ? h.message : null, since: h.since.toISOString() };
}
