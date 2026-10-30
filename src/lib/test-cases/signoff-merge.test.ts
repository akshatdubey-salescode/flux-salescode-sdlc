// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/signoff-merge.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTabs, type TabGrid } from "./multi-tab";
import type { RoundCaseRef } from "./signoff";
import { mergeOtherRoleStatuses } from "./signoff-merge";
import type { TcResult } from "./values";

const BASE = ["Test Case ID", "TC Classification", "TC Type", "Test Case Description", "Test Steps", "Expected Result"];
const row = (id: string, extra: string[]) => [id, "Positive", "Functional", `Scenario ${id}`, "1. do", "ok", ...extra];

function setup(header: string[], rows: string[][]) {
  const grids: TabGrid[] = [{ title: "T", grid: [header, ...rows] }];
  const parsed = parseTabs(grids, { uncapped: true });
  assert.ok(parsed.ok);
  const refs: RoundCaseRef[] = parsed.cases.map((c, i) => ({ id: `c${i}`, tcKey: c.tcKey, tcCode: c.tcId }));
  return { grids, parsed, refs };
}
const others = (m: Record<string, TcResult>) => new Map(Object.entries(m));

test("the tester signs off after the developer: the developer's results are written into the dev column", () => {
  const s = setup([...BASE, "Dev Status", "Tester Status"], [row("A", ["", "Passed"]), row("B", ["", "Failed"]), row("C", ["", "Passed"])]);
  const r = mergeOtherRoleStatuses({ role: "tester", ...s, other: others({ c0: "pass", c1: "blocked", c2: "not_run" }) });
  assert.equal(r.filled, 2);
  const out = r.grids[0].grid as string[][];
  assert.deepEqual([out[1][6], out[2][6], out[3][6]], ["Passed", "Blocked", ""], "not run is not written");
  assert.deepEqual([out[1][7], out[2][7]], ["Passed", "Failed"], "the uploader's own column is untouched");
});

test("the developer signs off after the tester: the tester's results go into the tester column", () => {
  const s = setup([...BASE, "DEV STATUS", "TESTER STATUS"], [row("A", ["Passed", ""])]);
  const r = mergeOtherRoleStatuses({ role: "dev", ...s, other: others({ c0: "fail" }) });
  assert.equal((r.grids[0].grid as string[][])[1][7], "Failed");
});

test("nothing is written when the other role has not signed off", () => {
  const s = setup([...BASE, "Dev Status"], [row("A", ["Passed"])]);
  const r = mergeOtherRoleStatuses({ role: "dev", ...s, other: new Map() });
  assert.equal(r.filled, 0);
  assert.equal(r.grids, s.grids, "the very same grids come back");
});

test("a real result already in the other column is kept; 'Not Executed' is replaced", () => {
  const s = setup([...BASE, "Dev Status", "Tester Status"], [row("A", ["Failed", "Passed"]), row("B", ["Not Executed", "Passed"])]);
  const r = mergeOtherRoleStatuses({ role: "tester", ...s, other: others({ c0: "pass", c1: "pass" }) });
  const out = r.grids[0].grid as string[][];
  assert.equal(out[1][6], "Failed", "the uploader's own Dev value wins");
  assert.equal(out[2][6], "Passed");
  assert.equal(r.filled, 1);
});

test("a sheet with no column for the other role gets one added at the end", () => {
  const s = setup([...BASE, "Tester Status"], [row("A", ["Passed"]), row("B", ["Passed"])]);
  const r = mergeOtherRoleStatuses({ role: "tester", ...s, other: others({ c0: "pass", c1: "fail" }) });
  const out = r.grids[0].grid as string[][];
  assert.equal(out[0][7], "DEV STATUS");
  assert.deepEqual([out[1][7], out[2][7]], ["Passed", "Failed"]);
  assert.equal(s.grids[0].grid[0].length, 7, "the input grid is not modified");
});

test("tabs and sections are matched to their own header rows", () => {
  const grids: TabGrid[] = [
    { title: "One", grid: [[...BASE, "Tester Status"], row("A", ["Passed"])] },
    { title: "Two", grid: [[...BASE, "Tester Status", "Dev Status"], row("A", ["Passed", ""])] },
  ];
  const parsed = parseTabs(grids, { uncapped: true });
  assert.ok(parsed.ok);
  const refs = parsed.cases.map((c, i) => ({ id: `c${i}`, tcKey: c.tcKey, tcCode: c.tcId }));
  const r = mergeOtherRoleStatuses({ role: "tester", parsed, grids, refs, other: others({ c0: "pass", c1: "blocked" }) });
  assert.equal((r.grids[0].grid as string[][])[1][7], "Passed");
  assert.equal((r.grids[1].grid as string[][])[1][7], "Blocked");
});
