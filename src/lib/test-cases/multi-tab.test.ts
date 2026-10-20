// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/multi-tab.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { caseKey, parseTabs } from "./multi-tab";
import { matchSignoff } from "./signoff";

const HEADER = [
  "Test Case ID", "Module", "Test Case Title", "Preconditions", "Test Steps", "Expected Result",
  "Remark", "QA Status", "QA Remarks", "Dev Status", "Dev Remarks",
];
const row = (id: string, qa = "", dev = "") => [id, "Mod", `Case ${id}`, "", "1. Do", "Works", "", qa, "", dev, ""];

test("the same ID on two tabs does not collide: keys are tab-qualified and each case knows its tab", () => {
  const r = parseTabs([
    { title: "Main", grid: [HEADER, row("TC1"), row("TC2")] },
    { title: "Extra", grid: [HEADER, row("TC1"), row("TC3")] },
  ]);
  assert.ok(r.ok);
  assert.equal(r.cases.length, 4);
  assert.deepEqual(r.cases.map((c) => c.sheetTab), ["Main", "Main", "Extra", "Extra"]);
  assert.equal(new Set(r.cases.map((c) => c.tcKey)).size, 4);
  assert.equal(r.cases[0].tcKey, caseKey("Main", "TC1"));
  assert.equal(r.cases[2].tcKey, caseKey("Extra", "TC1"));
  assert.equal(r.cases[0].tcId, "TC1", "the ID itself is untouched");
  assert.deepEqual(r.tabs.map((t) => [t.title, t.caseCount]), [["Main", 2], ["Extra", 2]]);
});

test("a duplicate ID inside one tab is still an error of that tab only, named in the issue", () => {
  const r = parseTabs([
    { title: "Main", grid: [HEADER, row("TC1"), row("TC1")] },
    { title: "Extra", grid: [HEADER, row("TC1")] },
  ]);
  assert.ok(r.ok);
  const errors = r.issues.filter((i) => i.severity === "error");
  assert.ok(errors.length >= 1);
  assert.ok(errors.every((e) => e.tab === "Main"));
  assert.equal(r.tabs.find((t) => t.title === "Main")!.errorCount, errors.length);
  assert.equal(r.tabs.find((t) => t.title === "Extra")!.errorCount, 0);
});

test("a tab that is not a test case sheet fails the whole selection and names the tab", () => {
  const r = parseTabs([
    { title: "Main", grid: [HEADER, row("TC1")] },
    { title: "Notes", grid: [["just"], ["words"]] },
  ]);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /^Tab "Notes":/);
});

test("selection rules: at least one, at most ten, no repeats, and a total row cap", () => {
  assert.equal(parseTabs([]).ok, false);
  const many = Array.from({ length: 11 }, (_, i) => ({ title: `T${i}`, grid: [HEADER, row("TC1")] }));
  assert.match((parseTabs(many) as { error: string }).error, /at most 10/);
  assert.match((parseTabs([{ title: "A", grid: [HEADER, row("TC1")] }, { title: "A", grid: [HEADER, row("TC2")] }]) as { error: string }).error, /twice/);
});

test("splits and unmapped values are summed across tabs", () => {
  const r = parseTabs([
    { title: "A", grid: [HEADER, row("TC1", "Passed"), row("TC2")] },
    { title: "B", grid: [HEADER, row("TC1"), row("TC2"), row("TC3")] },
  ]);
  assert.ok(r.ok);
  assert.equal(Object.values(r.categorySplit).reduce((a, b) => a + b, 0), 5);
});

test("sign-off matches by tab-qualified key, so results land on the right tab's case", () => {
  const r = parseTabs([
    { title: "Main", grid: [HEADER, row("TC1", "Passed"), row("TC2")] },
    { title: "Extra", grid: [HEADER, row("TC1", "Failed")] },
  ]);
  assert.ok(r.ok);
  const roundCases = r.cases.map((c, i) => ({ id: `id${i}`, tcKey: c.tcKey, tcCode: c.tcId }));
  const m = matchSignoff(roundCases, r.cases, "tester");
  assert.equal(m.results.find((x) => x.caseId === "id0")!.result, "pass", "Main/TC1");
  assert.equal(m.results.find((x) => x.caseId === "id2")!.result, "fail", "Extra/TC1");
  assert.deepEqual(m.missing, []);
  assert.deepEqual(m.unmatched, []);
});
