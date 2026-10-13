// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/signoff.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSignoff, signoffProblem } from "./signoff";
import { parseSheetGrid } from "./template";

const H = ["Test Case ID", "Test Case Title", "Test Steps", "Expected Result", "DEV STATUS", "DEV REMARKS", "TESTER STATUS", "TESTER REMARKS"];
const sheet = (rows: unknown[][]) => {
  const p = parseSheetGrid([H, ...rows]);
  assert.ok(p.ok);
  return p.cases;
};
const round = [
  { id: "c1", tcKey: "TC_001", tcCode: "TC_001" },
  { id: "c2", tcKey: "TC_002", tcCode: "TC_002" },
  { id: "c3", tcKey: "TC_003", tcCode: "TC_003" },
];

test("results are matched by key, per role, with remarks", () => {
  const cases = sheet([
    ["TC_001", "a", "s", "e", "Passed", "ok", "Failed", "broke on iOS"],
    ["TC_002", "b", "s", "e", "Blocked - Client Dependency", "", "Passed", ""],
    ["TC_003", "c", "s", "e", "", "", "", ""],
  ]);
  const dev = matchSignoff(round, cases, "dev");
  assert.deepEqual(dev.results.map((r) => r.result), ["pass", "blocked", "not_run"]);
  assert.deepEqual(dev.counts, { pass: 1, fail: 0, blocked: 1, not_run: 1 });
  assert.equal(dev.results[0].remark, "ok");

  const tester = matchSignoff(round, cases, "tester");
  assert.deepEqual(tester.results.map((r) => r.result), ["fail", "pass", "not_run"]);
  assert.equal(tester.results[0].remark, "broke on iOS");
});

test("row order does not matter; extra and missing cases are reported, missing ones count as not run", () => {
  const cases = sheet([
    ["TC_003", "c", "s", "e", "Passed", "", "", ""],
    ["TC_NEW", "z", "s", "e", "Passed", "", "", ""],
    ["TC_001", "a", "s", "e", "Failed", "", "", ""],
  ]);
  const m = matchSignoff(round, cases, "dev");
  assert.deepEqual(m.results.map((r) => [r.caseId, r.result]), [["c1", "fail"], ["c2", "not_run"], ["c3", "pass"]]);
  assert.deepEqual(m.unmatched, ["TC_NEW"]);
  assert.deepEqual(m.missing, ["TC_002"]);
});

test("section-prefixed keys match too", () => {
  const sectioned = [
    { id: "x1", tcKey: "Login / TC_001", tcCode: "TC_001" },
    { id: "x2", tcKey: "Cart / TC_001", tcCode: "TC_001" },
  ];
  const grid = [["Login"], H, ["TC_001", "a", "s", "e", "Passed", "", "", ""], ["Cart"], H, ["TC_001", "b", "s", "e", "Failed", "", "", ""]];
  const p = parseSheetGrid(grid);
  assert.ok(p.ok);
  const m = matchSignoff(sectioned, p.cases, "dev");
  assert.deepEqual(m.results.map((r) => r.result), ["pass", "fail"]);
});

test("tester name/date/app version is carried through; nothing marked or nothing matching is a problem", () => {
  const empty = matchSignoff(round, sheet([["TC_001", "a", "s", "e", "", "", "", ""]]), "dev");
  assert.match(signoffProblem(empty, 3) ?? "", /No statuses are filled in/);

  const wrong = matchSignoff(round, sheet([["OTHER_1", "a", "s", "e", "Passed", "", "", ""]]), "dev");
  assert.match(signoffProblem(wrong, 3) ?? "", /None of the test cases/);

  const ok = matchSignoff(round, sheet([["TC_001", "a", "s", "e", "Passed", "", "", ""]]), "dev");
  assert.equal(signoffProblem(ok, 3), null, "partial sign-off is allowed; the rest counts as not run");
});
