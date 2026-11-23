// Run: ./node_modules/.bin/tsx --test src/lib/movement/cron.test.ts
// Pure: which movements are due, and the runner with a fake select / refresh / clock (no DB, no Jira).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUCKET_MS, BUDGET_MS, CANDIDATE_POOL, MAX_PER_RUN, MIN_AGE_MS, isDue, pickDue, runMovementCheck, type Candidate } from "./cron";
import type { RefreshResult } from "./service/refresh";

const NOW = new Date("2026-11-19T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const min = (n: number) => n * 60_000;
const cand = (id: string, o: Partial<Candidate> = {}): Candidate => ({ id, status: "ready", refreshedAt: ago(min(60)), deliveryDeleted: false, deliveryCompleted: false, ...o });

describe("which movements are due", () => {
  it("only ready / signed_off / in_progress are due", () => {
    for (const status of ["ready", "signed_off", "in_progress"] as const) assert.equal(isDue(cand("a", { status }), NOW), true, status);
    for (const status of ["draft", "done", "cancelled"] as const) assert.equal(isDue(cand("a", { status }), NOW), false, status);
  });

  it("a deleted or completed delivery is never due", () => {
    assert.equal(isDue(cand("a", { deliveryDeleted: true }), NOW), false);
    assert.equal(isDue(cand("a", { deliveryCompleted: true }), NOW), false);
    assert.equal(isDue(cand("a", { deliveryDeleted: true, refreshedAt: null }), NOW), false);
  });

  it("refreshed within the last 25 minutes is not due; exactly 25 minutes, older, and never refreshed are", () => {
    assert.equal(MIN_AGE_MS, min(25));
    assert.equal(isDue(cand("a", { refreshedAt: ago(0) }), NOW), false);
    assert.equal(isDue(cand("a", { refreshedAt: ago(min(24) + 59_000) }), NOW), false);
    assert.equal(isDue(cand("a", { refreshedAt: ago(min(25)) }), NOW), true);
    assert.equal(isDue(cand("a", { refreshedAt: ago(min(26)) }), NOW), true);
    assert.equal(isDue(cand("a", { refreshedAt: null }), NOW), true);
    // a refresh time in the future (clock skew) is not due either
    assert.equal(isDue(cand("a", { refreshedAt: new Date(NOW.getTime() + 5000) }), NOW), false);
  });

  it("picks only due rows, at most 8, in a deterministic order that does not depend on the input order", () => {
    const list = [
      cand("m-fresh", { refreshedAt: ago(min(5)) }),
      cand("m-old", { refreshedAt: ago(min(300)) }),
      cand("m-null-b", { refreshedAt: null }),
      cand("m-done", { status: "done", refreshedAt: null }),
      cand("m-mid", { refreshedAt: ago(min(60)) }),
      cand("m-null-a", { refreshedAt: null }),
      cand("m-gone", { deliveryDeleted: true, refreshedAt: null }),
    ];
    assert.deepEqual([...pickDue(list, NOW)].sort(), ["m-mid", "m-null-a", "m-null-b", "m-old"]);
    assert.deepEqual(pickDue(list, NOW), pickDue([...list].reverse(), NOW));
    const many = Array.from({ length: 20 }, (_, i) => cand(`m${String(i).padStart(2, "0")}`, { refreshedAt: ago(min(30 + i)) }));
    assert.equal(pickDue(many, NOW).length, MAX_PER_RUN);
    assert.deepEqual(pickDue(many, NOW, 0), []);
    assert.deepEqual(pickDue([], NOW), []);
    assert.equal(CANDIDATE_POOL, 40);
  });

  it("the order ROTATES every 30-minute bucket and covers every due row over successive runs", () => {
    const many = Array.from({ length: 30 }, (_, i) => cand(`mov-${i}`, { refreshedAt: ago(min(40 + i)) }));
    const base = Math.floor(NOW.getTime() / BUCKET_MS) + 10; // later buckets: every row is due
    const order = (bucket: number) => pickDue(many, new Date(bucket * BUCKET_MS + 1000));
    // within one bucket the answer is stable (a retry of the same run picks the same rows)
    assert.deepEqual(order(base), pickDue(many, new Date(base * BUCKET_MS + BUCKET_MS - 1000)));
    assert.notDeepEqual(order(base), order(base + 1));
    const seen = new Set<string>();
    let runs = 0;
    while (seen.size < many.length && runs < 40) for (const id of order(base + runs++)) seen.add(id);
    assert.equal(seen.size, 30, `all 30 due rows got a turn`);
    assert.ok(runs <= 15, `took ${runs} runs of 8 for 30 rows`);
  });

  it("8 permanently failing rows (the stalest: a failure never advances refreshed_at) do not starve the others", () => {
    const failing = Array.from({ length: 8 }, (_, i) => cand(`bad-${i}`, { refreshedAt: ago(min(600 + i)) }));
    const healthy = Array.from({ length: 4 }, (_, i) => cand(`ok-${i}`, { refreshedAt: ago(min(40 + i)) }));
    const all = [...failing, ...healthy];
    // the old rule, strict stalest first: the 8 failing ones take every slot, forever
    const strict = [...all].sort((a, b) => a.refreshedAt!.getTime() - b.refreshedAt!.getTime()).slice(0, MAX_PER_RUN).map((c) => c.id);
    assert.ok(strict.every((id) => id.startsWith("bad-")));
    const picked = new Map<string, number>();
    const base = Math.floor(NOW.getTime() / BUCKET_MS) + 1;
    for (let r = 0; r < 12; r++) for (const id of pickDue(all, new Date((base + r) * BUCKET_MS))) picked.set(id, (picked.get(id) ?? 0) + 1);
    for (const h of healthy) assert.ok((picked.get(h.id) ?? 0) >= 1, `${h.id} never got a turn in 12 runs`);
  });
});

describe("the run", () => {
  const select = (cs: Candidate[]) => async () => cs;

  it("exits at once when nothing is due: no refresh call", async () => {
    let calls = 0;
    const s = await runMovementCheck({ now: () => NOW, select: select([cand("a", { status: "done" })]), refresh: async () => (calls++, { ok: true }) });
    assert.deepEqual(s, { due: 0, refreshed: 0, changed: 0, skipped: 0, errors: 0, notStarted: 0 });
    assert.equal(calls, 0);
  });

  it("refreshes at most 8, two at a time, and counts changed / skipped / errors without throwing", async () => {
    const cs = Array.from({ length: 12 }, (_, i) => cand(`m${i}`, { refreshedAt: null }));
    let running = 0;
    let maxRunning = 0;
    let k = 0;
    const seen: string[] = [];
    const s = await runMovementCheck({
      now: () => NOW,
      select: async (_n, limit) => cs.slice(0, limit), // the SQL limit (the pool of 40), as the real query applies it
      refresh: async (id): Promise<RefreshResult> => {
        const n = k++; // outcomes by order of start: which rows the rotation picked does not matter here
        seen.push(id);
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        if (n === 0) return { ok: true, changed: true };
        if (n === 1) return { error: "The refresh failed and nothing was changed; try again" };
        if (n === 2) return { refreshing: true };
        if (n === 3) return { skipped: "recent" };
        if (n === 4) throw new Error("db down");
        return { ok: true, changed: false };
      },
    });
    assert.equal(maxRunning, 2);
    assert.equal(seen.length, 8);
    assert.deepEqual(s, { due: 8, refreshed: 4, changed: 1, skipped: 2, errors: 2, notStarted: 0 });
  });

  it("stops STARTING work when the wall-clock budget is used up and reports how many were left", async () => {
    let t = 0;
    const cs = Array.from({ length: 8 }, (_, i) => cand(`m${i}`, { refreshedAt: null }));
    const s = await runMovementCheck({
      now: () => NOW,
      select: select(cs),
      clock: () => t,
      concurrency: 1,
      refresh: async () => {
        t += 100_000; // each refresh "takes" 100 s
        return { ok: true };
      },
    });
    assert.equal(BUDGET_MS, 240_000);
    assert.equal(s.refreshed, 3); // starts at 0, 100 s, 200 s; at 300 s the budget is gone
    assert.equal(s.notStarted, 5);
  });

  it("a failing selection query returns a flag and refreshes nothing", async () => {
    let calls = 0;
    const s = await runMovementCheck({ select: async () => { throw new Error("connection refused"); }, refresh: async () => (calls++, { ok: true }) });
    assert.equal(s.selectionFailed, true);
    assert.equal(s.due, 0);
    assert.equal(calls, 0);
  });

  it("the summary holds counts only", async () => {
    const s = await runMovementCheck({ now: () => NOW, select: select([cand("id-with-secret", { refreshedAt: null })]), refresh: async () => ({ ok: true }) });
    for (const v of Object.values(s)) assert.ok(typeof v === "number" || typeof v === "boolean");
  });
});

describe("a hung refresh", () => {
  const cs = Array.from({ length: 4 }, (_, i) => cand(`m${i}`, { refreshedAt: null }));
  const never = () => new Promise<RefreshResult>(() => {});

  it("is counted as an error after the per-refresh deadline; its worker stops, the other keeps going", async () => {
    let k = 0;
    const s = await runMovementCheck({ now: () => NOW, select: async () => cs, refreshTimeoutMs: 20, refresh: () => (k++ === 0 ? never() : Promise.resolve({ ok: true })) });
    assert.deepEqual(s, { due: 4, refreshed: 3, changed: 0, skipped: 0, errors: 1, notStarted: 0 });
  });

  it("when every worker hangs nothing more is started and the rest is reported as not started", async () => {
    let calls = 0;
    const s = await runMovementCheck({ now: () => NOW, select: async () => cs, refreshTimeoutMs: 20, refresh: () => (calls++, never()) });
    assert.equal(calls, 2);
    assert.deepEqual(s, { due: 4, refreshed: 0, changed: 0, skipped: 0, errors: 2, notStarted: 2 });
  });
});
