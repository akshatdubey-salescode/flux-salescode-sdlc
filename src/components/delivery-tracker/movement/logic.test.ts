import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyFailure, createTickBatcher, filterDeliveries, pollVerdict, refreshPollCount, refreshPollDelay } from "./logic";

describe("refresh polling", () => {
  it("backs off 4 s, 8 s, 15 s and stays inside the server's 5 minutes", () => {
    assert.deepEqual([0, 4, 5, 9, 10, 40].map(refreshPollDelay), [4000, 4000, 8000, 8000, 15000, 15000]);
    const n = refreshPollCount(300_000);
    let t = 0;
    for (let i = 0; i < n; i++) t += refreshPollDelay(i);
    assert.ok(t <= 300_000 && t + refreshPollDelay(n) > 300_000);
    assert.ok(n < 75, "fewer polls than the old flat 4 s schedule (75)");
  });
  it("verdict: continue while refreshing, failed with a NEW refreshError, done when refreshedAt moved or two quiet polls passed", () => {
    const before = { refreshedAt: "t1", refreshError: null as string | null };
    assert.equal(pollVerdict({ refreshing: true, refreshedAt: "t1", refreshError: null }, before, 0), "continue");
    assert.equal(pollVerdict({ refreshing: false, refreshedAt: "t1", refreshError: "Jira 503" }, before, 0), "failed");
    assert.equal(pollVerdict({ refreshing: false, refreshedAt: "t2", refreshError: null }, before, 0), "done");
    assert.equal(pollVerdict({ refreshing: false, refreshedAt: "t2", refreshError: "x" }, before, 0), "failed");
    assert.equal(pollVerdict({ refreshing: false, refreshedAt: "t1", refreshError: null }, before, 1), "continue");
    assert.equal(pollVerdict({ refreshing: false, refreshedAt: "t1", refreshError: null }, before, 2), "done");
    // an error that was already there before this refresh started is not "this refresh failed"
    assert.equal(pollVerdict({ refreshing: false, refreshedAt: "t1", refreshError: "old" }, { refreshedAt: "t1", refreshError: "old" }, 0), "continue");
  });
});

describe("tick batcher (fake timers)", () => {
  const make = (ok = true) => {
    const sent: Array<[string[], boolean]> = [];
    const settled: Array<[string[], boolean, boolean]> = [];
    const b = createTickBatcher({ send: async (ids, inc) => (sent.push([ids, inc]), ok), settled: (ids, inc, o) => settled.push([ids, inc, o]) });
    return { b, sent, settled };
  };
  it("ten rapid ticks inside 300 ms are ONE PATCH; the last choice per Jira wins; ticks before unticks", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { b, sent } = make();
    for (let i = 0; i < 10; i++) {
      b.push([`i${i}`], true);
      t.mock.timers.tick(100);
    }
    b.push(["i3"], false); // changed my mind about one
    assert.equal(sent.length, 0, "nothing is sent while the quiet period keeps restarting");
    t.mock.timers.tick(300);
    await b.flush();
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0], [["i0", "i1", "i2", "i4", "i5", "i6", "i7", "i8", "i9"], true]);
    assert.deepEqual(sent[1], [["i3"], false]);
  });
  it("more than 200 Jiras are split into PATCHes of 200", async () => {
    const { b, sent } = make();
    b.push(Array.from({ length: 450 }, (_, i) => `i${i}`), true);
    await b.flush();
    assert.deepEqual(sent.map(([ids]) => ids.length), [200, 200, 50]);
  });
  it("a failed PATCH is reported as not ok (the UI reverts) and the next batch still goes out", async () => {
    const { b, settled } = make(false);
    b.push(["a"], true);
    await b.flush();
    b.push(["b"], false);
    await b.flush();
    assert.deepEqual(settled, [[["a"], true, false], [["b"], false, false]]);
  });
  it("cancel drops what is pending", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { b, sent } = make();
    b.push(["a"], true);
    b.cancel();
    t.mock.timers.tick(1000);
    await b.flush();
    assert.equal(sent.length, 0);
    assert.equal(b.pending, 0);
  });
  it("batches sent while one is in flight wait for it (no two PATCHes race)", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const b = createTickBatcher({ send: async (ids) => (order.push(`start ${ids}`), ids[0] === "a" && (await gate), order.push(`end ${ids}`), true) });
    b.push(["a"], true);
    const first = b.flush();
    b.push(["b"], true);
    const second = b.flush();
    release();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["start a", "end a", "start b", "end b"]);
  });
});

describe("failed call classification", () => {
  const f = (status: number, body: Record<string, unknown> | null = null, timedOut = false) => classifyFailure({ status, timedOut, body });
  it("anything that may have reached the server, or says the state moved on, reloads", () => {
    for (const r of [f(0), f(500), f(503), f(0, null, true), f(403), f(409, { error: "x" })]) assert.equal(r.reload, true);
    assert.equal(f(400, { error: "bad" }).reload, false);
    assert.equal(f(404).reload, false);
  });
  it("stale hash and refresh-needed 409s are recognised; a 400 carries its slot", () => {
    assert.equal(f(409, { currentHash: "abc" }).kind, "stale_hash");
    assert.equal(f(409, { code: "inputs_stale" }).kind, "refresh_needed");
    assert.equal(f(409, { code: "refresh_failed" }).kind, "refresh_needed");
    assert.equal(f(409, { code: "blocked" }).kind, "plain");
    assert.equal(f(400, { slot: "lead" }).slot, "lead");
  });
});

describe("delivery filter keeps the pinned delivery", () => {
  const d = (id: string, statuses: string[], over: Record<string, unknown> = {}) => ({ id, completedAt: null as string | null, deliveryDate: "2026-11-20", items: statuses.map((status) => ({ status })), ...over });
  const none = { showCompleted: false, dateFrom: null, dateTo: null, query: "", statusFilter: new Set<string>(), pinned: new Set<string>() };
  const match = () => true;
  it("the item-status filter hides a delivery, unless it is pinned (its movement panel is open)", () => {
    const list = [d("a", ["delivered"]), d("b", ["pending"])];
    const f = { ...none, statusFilter: new Set(["pending"]) };
    assert.deepEqual(filterDeliveries(list, f, match).map((x) => x.id), ["b"]);
    const pinned = filterDeliveries(list, { ...f, pinned: new Set(["a"]) }, match);
    assert.deepEqual(pinned.map((x) => x.id), ["a", "b"]);
    assert.equal(pinned[0].visibleItems.length, 0, "its table is empty under the filter, but the card (and the panel) stay");
  });
  it("a pinned completed delivery is shown without 'show completed', and date / search filters do not hide it", () => {
    const list = [d("a", ["delivered"], { completedAt: "2026-11-01" }), d("b", ["pending"])];
    assert.deepEqual(filterDeliveries(list, { ...none, pinned: new Set(["a"]), dateFrom: "2027-01-01", query: "zzz" }, () => false).map((x) => x.id), ["a"]);
    assert.deepEqual(filterDeliveries(list, none, match).map((x) => x.id), ["b"]);
  });
  it("without a pin the filters apply as before", () => {
    const list = [d("a", ["x"], { deliveryDate: "2026-11-01" }), d("b", ["x"]), d("c", ["x"])];
    assert.deepEqual(filterDeliveries(list, { ...none, dateFrom: "2026-11-10" }, match).map((x) => x.id), ["b", "c"]);
    assert.deepEqual(filterDeliveries(list, { ...none, query: "q" }, (x) => x.id === "c").map((x) => x.id), ["c"]);
  });
});

import { checklistWanted } from "./logic";

describe("when the checklist payload is needed", () => {
  it("a tab that shows it, OR a user who can sign (a signer arriving from the e-mail is on the Jiras tab)", () => {
    assert.equal(checklistWanted(false, null), false);
    assert.equal(checklistWanted(false, { permissions: { sign: [] } }), false, "a viewer on the Jiras tab does not pay for the big payload");
    assert.equal(checklistWanted(false, { permissions: { sign: ["ba"] } }), true, "a signer must be able to sign from the first tab");
    assert.equal(checklistWanted(true, { permissions: { sign: [] } }), true);
    assert.equal(checklistWanted(true, undefined), true);
  });
});
