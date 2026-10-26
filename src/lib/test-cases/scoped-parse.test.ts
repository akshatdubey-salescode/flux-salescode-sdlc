// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/scoped-parse.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTabs } from "./multi-tab";
import { parseRowSpec, type ScopeInput } from "./scope";

const H = ["Test Case ID", "Test Case Title", "Test Steps", "Expected Result", "TC Type", "Priority"];
const row = (id: string) => [id, `t ${id}`, "s", "e", "Positive", "P1"];
const scopeOf = (tab: string, spec: string): ScopeInput => {
  const r = parseRowSpec(spec);
  assert.ok(r.ok);
  return new Map([[tab, r.ok ? r.ranges : null]]);
};
/** Rows 1-2 are notes, row 3 the header, rows 4.. cases A1..A(n). */
const oneSection = (n: number) => [["Notes"], [""], H, ...Array.from({ length: n }, (_, i) => row(`A${i + 1}`))];
/** Two sections: title row 1, header 2, cases rows 3-5 (S1-S3); blank 6; title 7, header 8, cases rows 9-11 (S1-S3 again). */
const twoSections = () => [["Login"], H, row("S1"), row("S2"), row("S3"), [], ["Orders"], H, row("S1"), row("S2"), row("S3")];

test("rows below the header are chosen; the header above the range is still found", () => {
  const p = parseTabs([{ title: "Main", grid: oneSection(10) }], { scope: scopeOf("Main", "6-8") });
  assert.ok(p.ok);
  assert.deepEqual(p.cases.map((c) => c.tcId), ["A3", "A4", "A5"]);
  assert.deepEqual(p.cases.map((c) => c.rowNumber), [6, 7, 8]);
  assert.equal(p.tabs[0].caseCount, 3);
  assert.equal(p.tabs[0].totalCases, 10);
  assert.equal(p.tabs[0].rows, "6-8");
  assert.deepEqual([p.tabs[0].firstId, p.tabs[0].lastId, p.tabs[0].firstRow, p.tabs[0].lastRow], ["A3", "A5", 6, 8]);
});

test("a case's key does not change with the rows chosen (also when only one of several sections is in scope)", () => {
  const whole = parseTabs([{ title: "Main", grid: twoSections() }]);
  const scoped = parseTabs([{ title: "Main", grid: twoSections() }], { scope: scopeOf("Main", "9-11") });
  assert.ok(whole.ok && scoped.ok);
  const wholeKeys = new Set(whole.cases.map((c) => c.tcKey));
  assert.ok(wholeKeys.has("Main::Orders / S1"));
  assert.deepEqual(scoped.cases.map((c) => c.tcKey), ["Main::Orders / S1", "Main::Orders / S2", "Main::Orders / S3"]);
  for (const c of scoped.cases) assert.ok(wholeKeys.has(c.tcKey), c.tcKey);
});

test("a duplicate ID outside the chosen rows does not block; one inside does", () => {
  const grid = [H, row("X1"), row("X1"), row("Y1"), row("Y2")];
  const whole = parseTabs([{ title: "Main", grid }]);
  assert.ok(whole.ok && whole.issues.some((i) => i.severity === "error"));
  const outside = parseTabs([{ title: "Main", grid }], { scope: scopeOf("Main", "4-5") });
  assert.ok(outside.ok);
  assert.equal(outside.issues.filter((i) => i.severity === "error").length, 0);
  const inside = parseTabs([{ title: "Main", grid }], { scope: scopeOf("Main", "2-4") });
  assert.ok(inside.ok && inside.issues.some((i) => i.severity === "error"));
});

test("rows with no test case are an error that says where the tab's test cases are", () => {
  const p = parseTabs([{ title: "Main", grid: oneSection(10) }], { scope: scopeOf("Main", "100-120") });
  assert.ok(!p.ok);
  assert.match(p.error, /Tab "Main": rows 100-120 contain no test cases/);
  assert.match(p.error, /rows 4-13|on rows 4-13/);
});

test("a tab over the case cap can still be scoped; the cap applies to the cases in scope", () => {
  const big = [H, ...Array.from({ length: 2050 }, (_, i) => row(`B${i + 1}`))];
  const whole = parseTabs([{ title: "Big", grid: big }]);
  assert.ok(!whole.ok && /Choose the rows that belong to this item/.test(whole.error));
  const scoped = parseTabs([{ title: "Big", grid: big }], { scope: scopeOf("Big", "2-101") });
  assert.ok(scoped.ok);
  assert.equal(scoped.cases.length, 100);
  assert.equal(scoped.tabs[0].totalCases, 2050);
});

test("the outline of a tab lists every section with its rows, whatever rows were chosen", () => {
  const p = parseTabs([{ title: "Main", grid: twoSections() }], { scope: scopeOf("Main", "3-4") });
  assert.ok(p.ok);
  const o = p.tabs[0].outline;
  assert.deepEqual(o.map((s) => [s.title, s.titleRow, s.headerRow, s.firstRow, s.lastRow, s.caseCount]), [
    ["Login", 1, 2, 3, 5, 3],
    ["Orders", 7, 8, 9, 11, 3],
  ]);
  assert.deepEqual(p.tabs[0].sections.map((s) => s.title), ["Login"], "only sections with cases in scope");
});

test("no tab named: tabs that are not test-case sheets are skipped and listed, the rest are reviewed", () => {
  const tabs = [
    { title: "Cover", grid: [["Project plan"], ["Owner", "Me"]] },
    { title: "Main", grid: oneSection(3) },
    { title: "Notes", grid: [["just text"]] },
  ];
  const p = parseTabs(tabs, { skipNonTc: true });
  assert.ok(p.ok);
  assert.deepEqual(p.tabs.map((t) => t.title), ["Main"]);
  assert.deepEqual(p.skipped.map((s) => s.tab), ["Cover", "Notes"]);
  assert.match(p.skipped[0].reason, /no Test Case ID header/);
  // Named tabs are not forgiven: the parse fails and names the tab.
  const strict = parseTabs(tabs);
  assert.ok(!strict.ok && /Tab "Cover"/.test(strict.error));
});

test("no tab named and nothing is a test-case sheet: a clear error", () => {
  const p = parseTabs([{ title: "Cover", grid: [["x"]] }, { title: "Notes", grid: [["y"]] }], { skipNonTc: true });
  assert.ok(!p.ok);
  assert.match(p.error, /None of the 2 tabs holds test cases/);
  assert.match(p.error, /Cover, Notes/);
});

test("a tab that is too big is not skipped when no tab was named (it must be scoped)", () => {
  const big = [H, ...Array.from({ length: 2050 }, (_, i) => row(`B${i + 1}`))];
  const p = parseTabs([{ title: "Big", grid: big }, { title: "Main", grid: oneSection(3) }], { skipNonTc: true });
  assert.ok(!p.ok && /Tab "Big": Too many test cases/.test(p.error));
});

test("rows that moved in the live sheet are noticed: the previous round's first and last IDs are found on new rows", () => {
  // The round covered rows 4-6 (A1..A3). Two rows were inserted above, so A1..A3 are now on rows 6-8.
  const moved = [["Notes"], [""], H, row("N1"), row("N2"), row("A1"), row("A2"), row("A3"), row("A4")];
  const anchors = new Map([["Main", { firstId: "A1", lastId: "A3", firstRow: 4, lastRow: 6 }]]);
  const p = parseTabs([{ title: "Main", grid: moved }], { scope: scopeOf("Main", "4-6"), anchors });
  assert.ok(p.ok);
  assert.deepEqual(p.tabs[0].realign, { rows: "6-8", firstRow: 6, lastRow: 8 });
  // Nothing moved: no hint. Rows already set to the suggestion: no hint.
  const same = parseTabs([{ title: "Main", grid: oneSection(5) }], { scope: scopeOf("Main", "4-6"), anchors });
  assert.ok(same.ok && same.tabs[0].realign === null);
  const already = parseTabs([{ title: "Main", grid: moved }], { scope: scopeOf("Main", "6-8"), anchors });
  assert.ok(already.ok && already.tabs[0].realign === null);
  // An ID that vanished gives no hint rather than a wrong one.
  const gone = parseTabs([{ title: "Main", grid: [H, row("Z1"), row("Z2")] }], { anchors });
  assert.ok(gone.ok && gone.tabs[0].realign === null);
});
