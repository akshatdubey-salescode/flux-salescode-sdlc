import test from "node:test";
import assert from "node:assert/strict";
import { reportWindow } from "./windows";

test("mtd window", () => {
  assert.deepEqual(reportWindow("2026-11-20", "mtd", null), {
    start: "2026-11-01",
    end: "2026-11-20",
    label: "MTD",
  });
  assert.equal(reportWindow("2026-11-01", "mtd", null).start, "2026-11-01");
});

test("ytd window", () => {
  const w = reportWindow("2026-11-20", "ytd", null);
  assert.equal(w.start, "2026-01-01");
  assert.equal(w.label, "YTD");
});

test("custom window", () => {
  const w = reportWindow("2026-11-20", "custom", "2026-11-01");
  assert.equal(w.start, "2026-11-01");
  assert.equal(w.end, "2026-11-20");
  assert.equal(w.label, "1 Nov – 20 Nov 2026");
});

test("custom with null start falls back to mtd", () => {
  const w = reportWindow("2026-11-20", "custom", null);
  assert.equal(w.label, "MTD");
  assert.equal(w.start, "2026-11-01");
});

test("custom start after report date is returned as-is (empty window)", () => {
  const w = reportWindow("2026-11-20", "custom", "2026-11-25");
  assert.equal(w.start, "2026-11-25");
  assert.equal(w.end, "2026-11-20");
});

test("custom spanning years shows both years", () => {
  const w = reportWindow("2027-01-05", "custom", "2026-12-28");
  assert.equal(w.label, "28 Dec 2026 – 5 Jan 2027");
});
