/**
 * The movement summary: ONE per movement (overwritten), either the AI-merged one or the deterministic roll-up.
 * The roll-up, the request to the AI, the validation of its answer and the hash come from checklist/ (rollup.ts,
 * summary-ai.ts); this file is the storage, the rate limit, the health gate and the degrade-to-rules rule.
 *
 *   getSummary       read: the stored summary when it is for the CURRENT checklist (fresh), else the deterministic roll-up
 *                    (stale / none / rules_only). No AI call, no Jira call.
 *   generateSummary  managers / admins: build the roll-up, and unless a stored AI summary already has the same hash
 *                    (`force` overrides) ask the AI (60 s, the shared AI health gate, callLlm's own retry on rate limits
 *                    and 5xx). Every failure DEGRADES to the deterministic summary with a plain reason; it never throws
 *                    at the UI. Prompts and raw model output are never stored or logged (counts only).
 * Limits per movement: 1 AI call per 20 s and 30 per day (HTTP 429 with a message).
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deliveryMovementSummaries } from "@/lib/db/schema";
import { LlmError, callLlm, getLlmConfig, type LlmConfig, type LlmRequest, type LlmResponse } from "@/lib/llm/minimax";
import { getHealth, onHold, recordOutcome, type HealthRow, type Outcome } from "@/lib/test-cases/ai-review/health";
import { ByteLru } from "../cache";
import { applySummary, buildRollup, buildSummaryRequest, rulesSummary, summaryFromResponse, summaryHash, type MergedSummary, type Rollup } from "../checklist";
import { MAX_SUMMARY_BYTES } from "../values";
import { checklistKey, currentChecklist, currentChecklistInput, loadItemRows, loadMovement } from "./core";
import { MovementError, type MovementActor } from "./types";

export const SUMMARY_MIN_INTERVAL_MS = 20_000;
export const SUMMARY_MAX_PER_DAY = 30;
export const SUMMARY_TIMEOUT_MS = 120_000;

export type SummaryStatus = "fresh" | "stale" | "none" | "rules_only";

export interface SummaryDeps {
  /** The AI call (tests inject a fake); default callLlm. */
  llm?: (req: LlmRequest, cfg: LlmConfig | null) => Promise<LlmResponse>;
  /** AI configuration; default getLlmConfig(). `null` = no key configured. */
  cfg?: LlmConfig | null;
  health?: () => Promise<Pick<HealthRow, "state" | "retryAt" | "message">>;
  recordOutcome?: (o: Outcome) => Promise<void>;
  now?: () => Date;
}

export interface SummaryView {
  /** What to show: the stored AI summary when it is `fresh`, else the deterministic summary of the current checklist. */
  summary: MergedSummary;
  /** The deterministic roll-up of the CURRENT checklist: render this at once while an AI summary loads or when there is none. */
  rollup: Rollup;
  status: SummaryStatus;
  /** Hash of the checklist input the CURRENT summary describes (the stored one is fresh only when it equals this). */
  hash: string;
  source: "ai" | "rules";
  generatedAt: string | null;
  generatedBy: string | null;
  model: string | null;
  /** Why the summary is the deterministic one although an AI summary was wanted. */
  note: string | null;
  ai: { available: boolean; reason: string | null };
}

/** Roll-ups are cached for a minute, keyed like the checklist (the same inputs, ticks, picks and comment edits). */
const rollupCache = new ByteLru<string, { rollup: Rollup; hash: string; rules: MergedSummary; bytes: number }>({ maxBytes: 8 * 1024 * 1024, ttlMs: 60_000, weigh: (v) => v.bytes });

async function currentRollup(head: Awaited<ReturnType<typeof loadMovement>>, rows: Awaited<ReturnType<typeof loadItemRows>>) {
  const key = checklistKey(head, rows);
  const hit = rollupCache.get(key);
  if (hit) return hit;
  // The checklist is built (and cached) once and handed to the roll-up, which would otherwise build its own.
  const [input, checklist] = await Promise.all([currentChecklistInput(db, head, rows), currentChecklist(db, head, rows)]);
  const rollup = buildRollup(input, { checklist });
  const v = { rollup, hash: summaryHash(rollup), rules: rulesSummary(rollup), bytes: 2 * Buffer.byteLength(JSON.stringify(rollup)) };
  rollupCache.set(key, v);
  return v;
}

async function aiAvailability(deps: SummaryDeps): Promise<{ available: boolean; reason: string | null }> {
  // Thinking tokens count toward the output limit; a structured summary needs little reasoning, so it runs at low effort.
  const baseCfg = deps.cfg === undefined ? getLlmConfig() : deps.cfg;
  const cfg = baseCfg && { ...baseCfg, effort: "low" };
  if (!cfg) return { available: false, reason: "The AI service is not configured" };
  try {
    const h = await (deps.health ?? getHealth)();
    if (onHold(h, deps.now?.() ?? new Date())) return { available: false, reason: "The AI service is on hold for now" };
  } catch {
    // an unreadable health row must not block reading a summary
  }
  return { available: true, reason: null };
}

function viewOf(
  row: typeof deliveryMovementSummaries.$inferSelect | undefined,
  cur: { rollup: Rollup; rules: MergedSummary },
  hash: string,
  ai: { available: boolean; reason: string | null }
): SummaryView {
  const rules = cur.rules;
  const rollup = cur.rollup;
  if (!row) return { summary: rules, rollup, status: "none", hash, source: "rules", generatedAt: null, generatedBy: null, model: null, note: null, ai };
  const same = row.hash === hash;
  const status: SummaryStatus = !same ? "stale" : row.source === "ai" ? "fresh" : "rules_only";
  return {
    // A stale summary is NOT shown as if it were current: the deterministic one for today's checklist is.
    summary: same && row.source === "ai" ? storedSummary(row.body, cur.rollup, rules) : rules,
    rollup,
    status,
    hash,
    source: row.source === "ai" ? "ai" : "rules",
    generatedAt: row.generatedAt.toISOString(),
    generatedBy: row.generatedBy,
    model: row.model,
    note: row.note,
    ai,
  };
}

export async function getSummary(deliveryId: string, movementId: string, deps: SummaryDeps = {}): Promise<SummaryView> {
  const head = await loadMovement(db, deliveryId, movementId);
  const rows = await loadItemRows(db, movementId);
  const cur = await currentRollup(head, rows);
  const [row] = await db.select().from(deliveryMovementSummaries).where(eq(deliveryMovementSummaries.movementId, movementId)).limit(1);
  return viewOf(row, cur, cur.hash, await aiAvailability(deps));
}

const REASONS: Record<string, string> = {
  not_configured: "The AI service is not configured.",
  auth: "The AI service rejected the key.",
  quota: "The AI service's quota is used up.",
  rate_limited: "The AI service is busy; try again shortly.",
  server: "The AI service had an error.",
  timeout: "The AI service took too long to answer.",
  network: "The AI service could not be reached.",
  empty: "The AI service gave no usable answer.",
  bad_request: "The AI service refused the request.",
};

/** An AI row keeps only what the model said (small); the merged summary is rebuilt from it and today's roll-up, which re-validates it. */
type AiStoredBody = { raw: unknown };
const isAiStored = (b: unknown): b is AiStoredBody => !!b && typeof b === "object" && "raw" in (b as object);

function storedSummary(body: unknown, rollup: Rollup, rules: MergedSummary): MergedSummary {
  if (isAiStored(body)) {
    const merged = applySummary(rollup, body.raw);
    return merged.source === "ai" ? merged : rules;
  }
  return body as MergedSummary; // a row written before the compact form
}

/** What is written to the capped jsonb column: a deterministic row keeps only the headline and glance, and nothing above the cap is stored. */
export function storableBody(source: "ai" | "rules", body: MergedSummary, rules: MergedSummary): MergedSummary {
  const out: MergedSummary = source === "rules" ? { ...body, sections: [] } : body;
  if (Buffer.byteLength(JSON.stringify(out)) >= MAX_SUMMARY_BYTES) return { ...rules, sections: [], glance: [], notes: ["too large to store"] };
  return out;
}

export async function generateSummary(deliveryId: string, movementId: string, actor: MovementActor, opts: { force?: boolean } = {}, deps: SummaryDeps = {}): Promise<SummaryView> {
  if (!actor.isManager) throw new MovementError(403, "Only delivery managers can generate the summary", "forbidden");
  const now = deps.now?.() ?? new Date();
  const head = await loadMovement(db, deliveryId, movementId);
  if (head.status === "cancelled") throw new MovementError(409, "A cancelled movement has no summary to generate", "conflict");
  const rows = await loadItemRows(db, movementId);
  const cur = await currentRollup(head, rows);
  const { rollup, hash, rules } = cur;
  const ai = await aiAvailability(deps);

  const [stored] = await db.select().from(deliveryMovementSummaries).where(eq(deliveryMovementSummaries.movementId, movementId)).limit(1);
  // The same checklist already has an AI summary: nothing to spend a call on.
  if (stored && stored.source === "ai" && stored.hash === hash && !opts.force) return viewOf(stored, cur, hash, ai);

  const save = async (v: { source: "ai" | "rules"; model: string | null; body: MergedSummary; raw?: unknown; note: string | null; inputHash: string | null }) => {
    // A deterministic row keeps only the headline and the glance (the rest is recomputed from the roll-up); an AI body
    // is stored as the engine returned it, and never above the cap.
    const body: unknown = v.source === "ai" && v.raw !== undefined && Buffer.byteLength(JSON.stringify(v.raw)) < MAX_SUMMARY_BYTES ? ({ raw: v.raw } satisfies AiStoredBody) : storableBody(v.source, v.body, rules);
    const values = { hash, source: v.source, model: v.model, body, note: v.note, generatedBy: actor.id, generatedAt: now, inputHash: v.inputHash };
    await db
      .insert(deliveryMovementSummaries)
      .values({ movementId, ...values })
      .onConflictDoUpdate({ target: deliveryMovementSummaries.movementId, set: values });
    const [row] = await db.select().from(deliveryMovementSummaries).where(eq(deliveryMovementSummaries.movementId, movementId)).limit(1);
    return viewOf(row, cur, hash, ai);
  };

  // A failed (re)generation must not replace a good AI summary of THIS checklist with the plainer one.
  const keepStored = stored && stored.source === "ai" && stored.hash === hash ? stored : null;
  const degrade = async (note: string, inputHash: string | null): Promise<SummaryView> =>
    keepStored ? { ...viewOf(keepStored, cur, hash, ai), note } : save({ source: "rules", model: null, body: rules, note, inputHash });

  // No AI (no key, or on hold): the deterministic summary, with the reason. No attempt is counted.
  if (!ai.available) return degrade(ai.reason ?? "The AI service is not available", null);

  // ---- an AI attempt: reserve it (rate limit) before spending the call
  const day = now.toISOString().slice(0, 10);
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(deliveryMovementSummaries).where(eq(deliveryMovementSummaries.movementId, movementId)).for("update");
    if (row?.lastAttemptAt && now.getTime() - row.lastAttemptAt.getTime() < SUMMARY_MIN_INTERVAL_MS) {
      const wait = Math.ceil((SUMMARY_MIN_INTERVAL_MS - (now.getTime() - row.lastAttemptAt.getTime())) / 1000);
      throw new MovementError(429, `A summary was just requested. Try again in ${wait} seconds.`, "rate_limited", { retryAfterSeconds: wait });
    }
    const today = row?.attemptsDay === day ? row.attemptsToday : 0;
    if (today >= SUMMARY_MAX_PER_DAY) throw new MovementError(429, `The limit of ${SUMMARY_MAX_PER_DAY} generated summaries per day for this movement is reached.`, "rate_limited");
    const counters = { lastAttemptAt: now, attemptsDay: day, attemptsToday: today + 1 };
    if (row) await tx.update(deliveryMovementSummaries).set(counters).where(eq(deliveryMovementSummaries.movementId, movementId));
    else {
      // The first attempt creates the row (with the deterministic summary, which is what is shown until the AI answers).
      await tx.insert(deliveryMovementSummaries).values({ movementId, hash, source: "rules", body: storableBody("rules", rules, rules), note: "The AI summary is being generated", generatedBy: actor.id, generatedAt: now, ...counters });
    }
  });

  const cfg = deps.cfg === undefined ? getLlmConfig() : deps.cfg;
  const req = buildSummaryRequest(rollup).request;
  const inputHash = createHash("sha1").update(JSON.stringify(req)).digest("hex");
  const call = deps.llm ?? callLlm;
  const report = deps.recordOutcome ?? recordOutcome;
  try {
    const run = (force: boolean) => call({ ...req, forceTool: force ? req.forceTool : undefined, timeoutMs: SUMMARY_TIMEOUT_MS }, cfg);
    let res: LlmResponse;
    try {
      res = await run(true);
    } catch (err) {
      // Some models refuse a forced tool call while thinking; the tool is still offered (same as the AI review).
      if (err instanceof LlmError && err.code === "bad_request" && /tool_choice|tool choice|thinking/i.test(err.message)) res = await run(false);
      else throw err;
    }
    await report({ ok: true });
    // The engine validates everything the model said; an answer it cannot use comes back as the deterministic summary.
    const merged = applySummary(rollup, summaryFromResponse(res));
    if (merged.source !== "ai") return degrade("The AI's answer could not be used.", inputHash);
    console.info(`[movement-summary] ${movementId}: ai summary stored (input tokens ${res.inputTokens}, output tokens ${res.outputTokens})`);
    return save({ source: "ai", model: res.model, body: merged, raw: summaryFromResponse(res), note: null, inputHash });
  } catch (err) {
    if (err instanceof MovementError) throw err;
    const code = err instanceof LlmError ? err.code : "network";
    if (err instanceof LlmError) await report({ ok: false, code: err.code, message: err.message });
    console.warn(`[movement-summary] ${movementId}: AI call failed (${code}); the deterministic summary is used`);
    return degrade(REASONS[code] ?? "The AI summary could not be generated.", inputHash);
  }
}
