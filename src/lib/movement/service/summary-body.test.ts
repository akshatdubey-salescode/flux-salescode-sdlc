import test from "node:test";
import assert from "node:assert/strict";
import { storableBody } from "./summary";
import { MAX_SUMMARY_BYTES } from "../values";
import type { MergedSummary } from "../checklist";

const body = (n: number): MergedSummary =>
  ({ headline: "h", notes: [], glance: [], sections: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: "t".repeat(100), entries: [] })) }) as unknown as MergedSummary;

test("a deterministic row drops the sections (recomputed from the roll-up)", () => {
  assert.equal(storableBody("rules", body(5), body(5)).sections.length, 0);
});

test("a body above the cap is replaced by the headline only", () => {
  const huge = { ...body(1), glance: Array.from({ length: 2000 }, (_, i) => ({ id: `g${i}`, text: "x".repeat(60) })) } as unknown as MergedSummary;
  const out = storableBody("ai", huge, body(2));
  assert.ok(Buffer.byteLength(JSON.stringify(out)) < MAX_SUMMARY_BYTES);
  assert.deepEqual(out.notes, ["too large to store"]);
});

test("an AI body under the cap is stored as returned", () => {
  const b = body(3);
  assert.equal(storableBody("ai", b, b), b);
});
