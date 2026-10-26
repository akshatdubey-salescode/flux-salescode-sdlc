// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/ai-review/health.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEGRADED_AFTER, EMPTY_HEALTH, PAUSE_RETRY_MS, nextHealth, onHold, type HealthRow } from "./health";
import { classifyHttpError, isServiceProblem } from "@/lib/llm/minimax";

const T0 = new Date("2026-10-21T10:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

test("quota, balance and usage-limit answers are told apart from a plain rate limit", () => {
  const q = (status: number, body: unknown) => classifyHttpError(status, typeof body === "string" ? body : JSON.stringify(body)).code;
  assert.equal(q(429, { error: { message: "You exceeded your current quota, please check your plan and billing details" } }), "quota");
  assert.equal(q(402, "Payment required"), "quota");
  assert.equal(q(429, { base_resp: { status_code: 1008, status_msg: "insufficient balance" } }), "quota");
  assert.equal(q(429, { base_resp: { status_code: 2056, status_msg: "usage limit exceeded (5h window)" } }), "quota");
  assert.equal(q(403, { error: { message: "Token plan expired" } }), "quota");
  assert.equal(q(429, { error: { message: "Too many requests, slow down" } }), "rate_limited");
  assert.equal(q(401, { error: { message: "invalid api key" } }), "auth");
  assert.equal(q(403, { error: { message: "forbidden" } }), "auth");
  assert.equal(q(503, "upstream down"), "server");
  assert.equal(q(400, { error: { message: "unsupported parameter" } }), "bad_request");
  assert.match(classifyHttpError(429, JSON.stringify({ error: { message: "quota exceeded for plan" } })).message, /quota or balance is used up: quota exceeded/);
});

test("which failures count as the service being unusable", () => {
  for (const c of ["quota", "auth", "rate_limited", "server", "timeout", "network"] as const) assert.ok(isServiceProblem(c), c);
  for (const c of ["empty", "bad_request", "not_configured"] as const) assert.ok(!isServiceProblem(c), c);
});

test("a quota or key failure puts the service on hold at once, with a retry time", () => {
  const h = nextHealth(EMPTY_HEALTH, { ok: false, code: "quota", message: "quota used up" }, T0);
  assert.equal(h.state, "paused");
  assert.equal(h.reason, "quota");
  assert.equal(h.retryAt!.getTime(), T0.getTime() + PAUSE_RETRY_MS);
  assert.ok(onHold(h, later(60_000)));
  assert.ok(!onHold(h, later(PAUSE_RETRY_MS + 1)), "after the wait, one automatic review may probe the service again");
  assert.equal(nextHealth(EMPTY_HEALTH, { ok: false, code: "auth", message: "bad key" }, T0).reason, "auth");
});

test("a repeated failure keeps the original 'since' and pushes the retry time out", () => {
  const first = nextHealth(EMPTY_HEALTH, { ok: false, code: "quota", message: "x" }, T0);
  const again = nextHealth(first, { ok: false, code: "quota", message: "x" }, later(20 * 60_000));
  assert.equal(again.since.getTime(), T0.getTime());
  assert.equal(again.retryAt!.getTime(), later(20 * 60_000).getTime() + PAUSE_RETRY_MS);
});

test("one-off trouble is tolerated; a run of failures shows as degraded; a success clears everything", () => {
  let h: HealthRow = EMPTY_HEALTH;
  for (let i = 1; i < DEGRADED_AFTER; i++) {
    h = nextHealth(h, { ok: false, code: "server", message: "503" }, later(i * 1000));
    assert.equal(h.state, "ok", `failure ${i} alone is not shown`);
  }
  h = nextHealth(h, { ok: false, code: "timeout", message: "slow" }, later(10_000));
  assert.equal(h.state, "degraded");
  assert.ok(!onHold(h, later(11_000)), "degraded does not stop automatic reviews");
  const ok = nextHealth(h, { ok: true }, later(20_000));
  assert.deepEqual([ok.state, ok.reason, ok.failureStreak, ok.retryAt], ["ok", null, 0, null]);
  assert.equal(ok.lastOkAt!.getTime(), later(20_000).getTime());
});

test("a failure that is not about the service (empty or malformed answer) changes nothing", () => {
  const h = nextHealth(EMPTY_HEALTH, { ok: false, code: "empty", message: "no answer" }, T0);
  assert.equal(h, EMPTY_HEALTH);
});

test("a success while on hold (a manual run or a check) releases the hold", () => {
  const paused = nextHealth(EMPTY_HEALTH, { ok: false, code: "quota", message: "x" }, T0);
  const ok = nextHealth(paused, { ok: true }, later(5 * 60_000));
  assert.equal(ok.state, "ok");
  assert.ok(!onHold(ok, later(6 * 60_000)));
});
