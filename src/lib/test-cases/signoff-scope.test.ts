// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/signoff-scope.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTabs } from "./multi-tab";
import { matchSignoff, type RoundCaseRef } from "./signoff";
import type { RoundScope } from "./scope";

const H = ["Test Case ID", "Test Case Title", "Test Steps", "Expected Result", "Tester Status", "Tester Remarks"];
const r = (id: string, status = "", remark = "") => [id, `t ${id}`, "s", "e", status, remark];

const scope = (rows: string, ranges: [number, number][]): RoundScope => ({
  defaulted: false,
  skipped: [],
  tabs: [{ tab: "Main", rows, ranges, gid: null, totalInTab: 10, inScope: 3, firstId: "A1", lastId: "A3", firstRow: 3, lastRow: 5 }],
});
// The round (approved earlier) holds A1-A3 on rows 3-5 of the tab.
const round: RoundCaseRef[] = ["A1", "A2", "A3"].map((id, i) => ({ id: `c${i + 1}`, tcKey: `Main::${id}`, tcCode: id, rowNo: 3 + i }));
const parse = (grid: unknown[][]) => {
  const p = parseTabs([{ title: "Main", grid }], { uncapped: true });
  assert.ok(p.ok);
  return p.ok ? p.cases : [];
};

test("on a shared sheet only the round's own cases are matched; other features' rows are not 'unmatched'", () => {
  // Rows 3-5 are this item's (A1-A3); rows 6-8 belong to another feature (B1-B3).
  const sheet = parse([["x"], H, r("A1", "Passed"), r("A2", "Failed", "bad"), r("A3", "Passed"), r("B1", "Passed"), r("B2", "Passed"), r("B3", "Passed")]);
  const m = matchSignoff(round, sheet, "tester", scope("3-5", [[3, 5]]));
  assert.deepEqual(m.counts, { pass: 2, fail: 1, blocked: 0, not_run: 0 });
  assert.deepEqual(m.unmatched, [], "B1-B3 sit outside this round's rows");
  assert.equal(m.moved, 0);
});

test("a test case added inside the round's rows is reported; a whole-tab round reports every extra", () => {
  const sheet = parse([["x"], H, r("A1", "Passed"), r("A2", "Passed"), r("A3", "Passed"), r("NEW", "Passed"), r("B1", "Passed")]);
  assert.deepEqual(matchSignoff(round, sheet, "tester", scope("3-6", [[3, 6]])).unmatched, ["NEW"]);
  assert.deepEqual(matchSignoff(round, sheet, "tester", null).unmatched, ["NEW", "B1"]);
});

test("a key that appears twice resolves to the row the round stored (the other feature's duplicate is ignored)", () => {
  // Another feature reuses the ID "A2" on row 8 with a different status.
  const sheet = parse([["x"], H, r("A1", "Passed"), r("A2", "Passed"), r("A3", "Passed"), r("B1", "Passed"), r("B2", "Passed"), r("A2", "Failed", "other feature")]);
  const m = matchSignoff(round, sheet, "tester", scope("3-5", [[3, 5]]));
  assert.deepEqual(m.counts, { pass: 3, fail: 0, blocked: 0, not_run: 0 });
});

test("rows inserted above move the cases; they are still matched by ID and counted as moved", () => {
  // Two rows were inserted above, so A1-A3 are now on rows 5-7.
  const sheet = parse([["x"], H, r("N1", "Passed"), r("N2", "Passed"), r("A1", "Passed"), r("A2", "Passed"), r("A3", "Failed")]);
  const m = matchSignoff(round, sheet, "tester", scope("3-5", [[3, 5]]));
  assert.deepEqual(m.counts, { pass: 2, fail: 1, blocked: 0, not_run: 0 });
  assert.equal(m.moved, 3);
  assert.deepEqual(m.missing, []);
});

test("tester name/date comes from this round's cases, not from another feature's rows", () => {
  const H2 = [...H, "Tested By"];
  const withMeta = (id: string, who: string) => [id, `t ${id}`, "s", "e", "Passed", "", who];
  const sheet = parse([["x"], H2, withMeta("B1", "Someone Else"), withMeta("A1", "Asha"), withMeta("A2", "Asha"), withMeta("A3", "Asha")]);
  const m = matchSignoff(round, sheet, "tester", null);
  assert.ok(!/Someone Else/.test(m.meta));
});
