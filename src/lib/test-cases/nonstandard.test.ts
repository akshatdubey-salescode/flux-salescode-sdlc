// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/nonstandard.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectNonstandard, nonstandardMessage } from "./nonstandard";

const row = (over: Record<string, string>) => ({ "Test Case ID": "TC_01", "TC Type": "Functional", Classification: "Positive", "Tester Status": "Passed", Severity: "High", Priority: "P1", ...over });

test("recognised values (including the newly mapped QA types, Corner and Not Executed) produce nothing", () => {
  const rows = [
    row({ "TC Type": "Offline/Sync" }), row({ "TC Type": "File/SFTP", Classification: "Corner" }), row({ "TC Type": "Batch/Scheduler", "Tester Status": "Not Executed" }),
    row({ "TC Type": "UI / Functional", Classification: "Negative / Edge Case" }), row({ "TC Type": "Calculation" }),
  ];
  assert.deepEqual(collectNonstandard(rows), []);
});

test("unknown values are counted per field, case-insensitively, most frequent first", () => {
  const rows = [
    row({ "TC Type": "Smoke" }), row({ "TC Type": "smoke" }), row({ "TC Type": "Smoke" }),
    row({ Classification: "Sanity" }), row({ "Tester Status": "Maybe" }), row({ Priority: "urgent-ish" }),
  ];
  assert.deepEqual(collectNonstandard(rows), [
    { field: "TC type", value: "Smoke", count: 3 },
    { field: "Classification", value: "Sanity", count: 1 },
    { field: "Priority", value: "urgent-ish", count: 1 },
    { field: "Tester status", value: "Maybe", count: 1 },
  ]);
});

test("a partly unknown compound reports only the unknown part", () => {
  assert.deepEqual(collectNonstandard([row({ "TC Type": "Functional / Smoke" })]), [{ field: "TC type", value: "smoke", count: 1 }]);
});

test("columns are found by what they are called, in any order or spelling", () => {
  assert.deepEqual(collectNonstandard([{ "TC TYPE": "Smoke", "tc classification": "Positive" }]), [{ field: "TC type", value: "Smoke", count: 1 }]);
  assert.deepEqual(collectNonstandard([{ "Some other column": "Smoke" }]), []);
});

test("the finding text names each value with its count and the accepted values; nothing to say gives null", () => {
  assert.equal(nonstandardMessage([], 10), null);
  const msg = nonstandardMessage([{ field: "TC type", value: "Smoke", count: 3 }, { field: "Tester status", value: "Maybe", count: 1 }], 20)!;
  assert.match(msg, /4 values across 20 test cases/);
  assert.match(msg, /TC type: "Smoke" × 3/);
  assert.match(msg, /Tester status: "Maybe" × 1/);
  assert.match(msg, /Offline \/ Sync/);
  assert.match(msg, /Passed, Failed, Blocked, Not run/);
  assert.equal(nonstandardMessage([{ field: "TC type", value: "Smoke", count: 3 }], 20), nonstandardMessage([{ field: "TC type", value: "Smoke", count: 3 }], 20), "stable text, so an accepted finding is recognised on the next run");
});

test("long lists are cut with a count of what is left out", () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ field: "TC type" as const, value: `Kind${i}`, count: 1 }));
  assert.match(nonstandardMessage(many, 15)!, /and 3 more/);
});
