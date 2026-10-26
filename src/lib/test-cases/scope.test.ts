// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/scope.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeScope, formatRanges, inRanges, mergeRanges, parseRowSpec, parseScopeField, type RoundScope } from "./scope";

test("row specs: ranges, single rows, mixed separators and cell-style references", () => {
  const ok = (s: string) => {
    const r = parseRowSpec(s);
    assert.ok(r.ok, s);
    return r;
  };
  assert.deepEqual(ok("12-40, 55, 60-70").ranges, [[12, 40], [55, 55], [60, 70]]);
  assert.equal(ok("12-40, 55, 60-70").text, "12-40, 55, 60-70");
  assert.deepEqual(ok("5").ranges, [[5, 5]]);
  assert.deepEqual(ok("12 - 40;55\n60–70").ranges, [[12, 40], [55, 55], [60, 70]]);
  assert.deepEqual(ok("A12:F40, B55").ranges, [[12, 40], [55, 55]]);
  assert.deepEqual(ok("12:40").ranges, [[12, 40]]);
});

test("overlapping and touching ranges are merged and sorted", () => {
  assert.deepEqual(mergeRanges([[20, 30], [1, 5], [6, 10], [25, 40]]), [[1, 10], [20, 40]]);
  assert.equal(parseRowSpec("30-40, 1-5, 35-50, 6").ok && formatRanges((parseRowSpec("30-40, 1-5, 35-50, 6") as { ranges: [number, number][] }).ranges), "1-6, 30-50");
});

test("bad row specs are refused with a reason", () => {
  const bad = (s: string) => {
    const r = parseRowSpec(s);
    assert.ok(!r.ok, s);
    return r.ok ? "" : r.error;
  };
  assert.match(bad(""), /Enter the rows/);
  assert.match(bad("40-12"), /first row is after the last/);
  assert.match(bad("abc"), /not a row or a range/);
  assert.match(bad("0-5"), /start at 1/);
  assert.match(bad("1-999999"), /up to 100000/);
  assert.match(bad("1-2-3"), /not a row or a range/);
  const many = Array.from({ length: 60 }, (_, i) => `${i * 3 + 1}`).join(",");
  assert.match(bad(many), /at most 50 ranges/);
});

test("inRanges: null means every row; ends are inclusive", () => {
  assert.ok(inRanges(1, null) && inRanges(999, undefined));
  const r: [number, number][] = [[12, 40], [55, 55]];
  assert.deepEqual([11, 12, 40, 41, 55, 56].map((n) => inRanges(n, r)), [false, true, true, false, true, false]);
});

test("the form's scope field: per-tab rows, blank means the whole tab, bad rows name the tab", () => {
  const ok = parseScopeField(JSON.stringify([{ tab: "Main", rows: "12-40, 55" }, { tab: "Extra", rows: " " }]));
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual([...ok.scope.keys()], ["Main"]);
    assert.equal(ok.rows.get("Main"), "12-40, 55");
  }
  assert.ok(parseScopeField(null).ok && parseScopeField("").ok);
  const bad = parseScopeField(JSON.stringify([{ tab: "Main", rows: "9-2" }]));
  assert.ok(!bad.ok && /Tab "Main"/.test(bad.error));
  assert.ok(!parseScopeField("not json").ok && !parseScopeField("{}").ok);
});

test("describeScope reads naturally", () => {
  const scope: RoundScope = {
    defaulted: false,
    skipped: [],
    tabs: [
      { tab: "Main", rows: "12-40", ranges: [[12, 40]], gid: 1, totalInTab: 142, inScope: 28, firstId: "TC-101", lastId: "TC-128", firstRow: 12, lastRow: 40 },
      { tab: "Extra", rows: null, ranges: null, gid: 2, totalInTab: 14, inScope: 14, firstId: "E1", lastId: "E14", firstRow: 3, lastRow: 16 },
    ],
  };
  assert.equal(describeScope(scope), "Main rows 12-40 (28 of 142 TCs); Extra: all rows (14 TCs)");
  assert.match(describeScope({ ...scope, defaulted: true }), /^All tabs \(none was named\): /);
  assert.equal(describeScope(null, ["A", "B"]), "A, B: all rows");
});
