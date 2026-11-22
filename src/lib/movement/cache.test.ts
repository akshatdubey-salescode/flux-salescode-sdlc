import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ByteLru, recordCacheKey } from "./cache";

// weigh() returns the string length; every entry also costs the fixed overhead (96).
const mk = (maxBytes: number, extra: { ttlMs?: number; now?: () => number } = {}) =>
  new ByteLru<string, string>({ maxBytes, weigh: (v) => v.length, ...extra });

describe("ByteLru", () => {
  it("evicts the oldest entries until the byte budget holds, and never exceeds it", () => {
    const c = mk(3 * (100 + 96));
    for (let i = 0; i < 50; i++) {
      c.set(`k${i}`, "x".repeat(100));
      assert.ok(c.bytes <= 3 * 196, `bytes ${c.bytes} within budget`);
    }
    assert.equal(c.size, 3);
    assert.deepEqual([c.has("k47"), c.has("k48"), c.has("k49")], [true, true, true]);
    assert.equal(c.has("k46"), false);
    assert.equal(c.evictions, 47);
  });

  it("a read refreshes recency: the entry that was read survives the next eviction", () => {
    const c = mk(3 * 196);
    c.set("a", "x".repeat(100));
    c.set("b", "x".repeat(100));
    c.set("c", "x".repeat(100));
    assert.ok(c.get("a"));
    c.set("d", "x".repeat(100)); // evicts b (oldest untouched), not a
    assert.equal(c.has("a"), true);
    assert.equal(c.has("b"), false);
    assert.equal(c.has("c"), true);
  });

  it("evicts several small entries to make room for one large one", () => {
    const c = mk(1000);
    for (let i = 0; i < 5; i++) c.set(`s${i}`, "x".repeat(10));
    c.set("big", "x".repeat(700));
    assert.equal(c.has("big"), true);
    assert.ok(c.bytes <= 1000);
  });

  it("does not store a value bigger than the whole budget (and drops the stale smaller value)", () => {
    const c = mk(500);
    c.set("k", "small");
    assert.equal(c.set("k", "x".repeat(600)), false);
    assert.equal(c.has("k"), false);
    assert.equal(c.bytes, 0);
  });

  it("replacing a key adjusts the byte count instead of double counting", () => {
    const c = mk(10_000);
    c.set("k", "x".repeat(100));
    c.set("k", "x".repeat(40));
    assert.equal(c.bytes, 40 + 96);
    assert.equal(c.size, 1);
  });

  it("expires entries after the TTL", () => {
    let t = 1_000;
    const c = mk(10_000, { ttlMs: 60_000, now: () => t });
    c.set("k", "v");
    t += 59_999;
    assert.equal(c.get("k"), "v");
    t += 2;
    assert.equal(c.get("k"), undefined);
    assert.equal(c.size, 0);
    assert.equal(c.bytes, 0);
  });

  it("drops expired entries before evicting live ones", () => {
    let t = 0;
    const c = mk(2 * 196, { ttlMs: 100, now: () => t });
    c.set("old", "x".repeat(100));
    t = 50;
    c.set("live", "x".repeat(100));
    t = 120; // "old" expired, "live" has 30 ms left
    c.set("new", "x".repeat(100));
    assert.equal(c.has("live"), true);
    assert.equal(c.has("new"), true);
    assert.equal(c.evictions, 0);
  });
});

describe("recordCacheKey", () => {
  it("changes when the comment is edited", () => {
    assert.notEqual(recordCacheKey("81399", "2026-11-19T11:20:42.624+0000"), recordCacheKey("81399", "2026-11-19T12:00:00.000+0000"));
  });
});
