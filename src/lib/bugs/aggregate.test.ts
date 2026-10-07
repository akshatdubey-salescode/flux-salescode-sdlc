// Unit tests for the Bug Board's By Project aggregation + the filter/sort
// helpers shared with the By Developer view.
//
// The core invariant: for the same cells and filters, the By Project and By
// Developer views must add up to exactly the same numbers.
//
// Run: ./node_modules/.bin/tsx --test "src/lib/bugs/aggregate.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BugCell } from "@/app/api/bugs/route";
import {
  applyBoardFilters,
  buildOwnerRows,
  buildProjectRows,
  compareCountRows,
  computeProjectStats,
  mergeOwnerBreakdowns,
  sumCounts,
  UNASSIGNED_KEY,
  type Counts,
  type PriorityKey,
} from "./aggregate";

function cell(over: Partial<BugCell> & Pick<BugCell, "projectId" | "projectName">): BugCell {
  return {
    ownerKey: null, ownerName: null, ownerEmail: null, ownerAccount: null,
    jiraBaseUrl: "https://jira.example", jiraProjectKey: "KEY", environment: "Prod",
    total: 0, p1: 0, p2: 0, p3: 0, p4: 0,
    open: 0, open1: 0, open2: 0, open3: 0, open4: 0,
    cfTotal: 0, cf1: 0, cf2: 0, cf3: 0, cf4: 0,
    rcaMissingTotal: 0, rcaMissing1: 0, rcaMissing2: 0, rcaMissing3: 0, rcaMissing4: 0,
    ...over,
  };
}

const alice = { ownerKey: "alice@x.com", ownerName: "Alice", ownerEmail: "alice@x.com", ownerAccount: "a1" };
const bob = { ownerKey: "bob@x.com", ownerName: "Bob", ownerEmail: "bob@x.com", ownerAccount: "b1" };

const CELLS: BugCell[] = [
  // Alice on Alpha, in two environments — must merge into one Alpha/Alice slice.
  cell({ ...alice, projectId: "p-alpha", projectName: "Alpha", environment: "Prod", total: 3, p1: 1, p2: 2, open: 2, open1: 1, open2: 1, cfTotal: 1, cf1: 1, rcaMissingTotal: 2, rcaMissing2: 2 }),
  cell({ ...alice, projectId: "p-alpha", projectName: "Alpha", environment: "UAT", total: 1, p3: 1, open: 1, open3: 1 }),
  cell({ ...bob, projectId: "p-alpha", projectName: "Alpha", total: 2, p2: 1, p4: 1, rcaMissingTotal: 1, rcaMissing4: 1 }),
  cell({ ...bob, projectId: "p-beta", projectName: "Beta", total: 4, p1: 2, p3: 2, open: 3, open1: 1, open3: 2, cfTotal: 2, cf1: 1, cf3: 1 }),
  // No owner at all.
  cell({ projectId: "p-beta", projectName: "Beta", total: 1, p2: 1, rcaMissingTotal: 1, rcaMissing2: 1 }),
];

const NONE = new Set<string>();
const ALL_PRIORITIES = new Set<PriorityKey>(["p1", "p2", "p3", "p4"]);

test("project rows merge environments and total every cell once", () => {
  const rows = buildProjectRows(CELLS, NONE, NONE);
  assert.equal(rows.length, 2);

  const alpha = rows.find((r) => r.projectId === "p-alpha")!;
  assert.equal(alpha.name, "Alpha");
  assert.equal(alpha.total, 6);
  assert.equal(alpha.p1, 1);
  assert.equal(alpha.p3, 1);
  assert.equal(alpha.open, 3);
  assert.equal(alpha.rcaMissingTotal, 3);

  const aliceSlice = alpha.owners.find((o) => o.key === "alice@x.com")!;
  assert.equal(aliceSlice.total, 4, "Prod + UAT cells for one developer collapse into one slice");
  assert.equal(alpha.owners.length, 2);
});

test("By Project and By Developer add up to the same grand totals", () => {
  const projectTotal = sumCounts(buildProjectRows(CELLS, NONE, NONE));
  const ownerTotal = sumCounts(buildOwnerRows(CELLS, NONE));
  assert.deepEqual(projectTotal, ownerTotal);
});

test("the no-owner bucket is its own slice, sorted last", () => {
  const beta = buildProjectRows(CELLS, NONE, NONE).find((r) => r.projectId === "p-beta")!;
  assert.equal(beta.owners.length, 2);
  assert.equal(beta.owners[0].key, "bob@x.com");
  assert.equal(beta.owners[1].key, UNASSIGNED_KEY);
  assert.equal(beta.owners[1].isUnassigned, true);
});

test("the Developers filter narrows what is counted and drops the no-owner bucket", () => {
  const rows = buildProjectRows(CELLS, NONE, new Set(["bob@x.com"]));
  assert.equal(sumCounts(rows).total, 6, "Bob: 2 on Alpha + 4 on Beta");
  assert.ok(rows.every((r) => r.owners.every((o) => o.key === "bob@x.com")));

  // Same selection through the By Developer view reaches the same number.
  const bobRow = buildOwnerRows(CELLS, NONE).find((r) => r.key === "bob@x.com")!;
  assert.equal(bobRow.total, sumCounts(rows).total);
});

test("the Projects filter keeps only the selected projects", () => {
  const rows = buildProjectRows(CELLS, new Set(["p-beta"]), NONE);
  assert.deepEqual(rows.map((r) => r.projectId), ["p-beta"]);
  assert.equal(rows[0].total, 5);
});

test("priority filter scopes totals and RCA to the selected priorities", () => {
  const alpha = buildProjectRows(CELLS, NONE, NONE).find((r) => r.projectId === "p-alpha")!;
  const p2Only = applyBoardFilters(alpha, new Set<PriorityKey>(["p2"]), false);
  assert.equal(p2Only.total, 3, "2 Alice P2 + 1 Bob P2");
  assert.equal(p2Only.rcaMissingTotal, 2);
  assert.deepEqual(applyBoardFilters(alpha, ALL_PRIORITIES, false), alpha);
});

test("customer-found only re-points priorities at the customer-found counts and zeroes Open", () => {
  const alpha = buildProjectRows(CELLS, NONE, NONE).find((r) => r.projectId === "p-alpha")!;
  const cf = applyBoardFilters(alpha, ALL_PRIORITIES, true);
  assert.equal(cf.total, alpha.cfTotal);
  assert.equal(cf.p1, 1);
  assert.equal(cf.open, 0);
});

test("compareCountRows sorts by the active column, sinking zeros, with a stable name tie-break", () => {
  const rows = buildProjectRows(CELLS, NONE, NONE);
  const byTotalDesc = [...rows].sort((a, b) => compareCountRows(a, b, "total", "desc"));
  assert.deepEqual(byTotalDesc.map((r) => r.name), ["Alpha", "Beta"].sort(
    (a, b) => rows.find((r) => r.name === b)!.total - rows.find((r) => r.name === a)!.total,
  ));

  const zeroP4: Counts & { name: string } = { ...sumCounts([]), name: "Zed", p4: 0 };
  const hasP4: Counts & { name: string } = { ...sumCounts([]), name: "Amy", p4: 1 };
  assert.ok(compareCountRows(hasP4, zeroP4, "p4", "asc") < 0, "a zero sinks below a real value even ascending");
  assert.ok(compareCountRows(hasP4, zeroP4, "p4", "desc") < 0);

  const a = { ...sumCounts([]), name: "Alpha", total: 2 };
  const b = { ...sumCounts([]), name: "Beta", total: 2 };
  assert.ok(compareCountRows(a, b, "total", "desc") < 0, "equal rows fall back to name order");
});

test("mergeOwnerBreakdowns collapses a developer across projects (Total row)", () => {
  const merged = mergeOwnerBreakdowns(buildProjectRows(CELLS, NONE, NONE));
  const bobTotal = merged.find((o) => o.key === "bob@x.com")!;
  assert.equal(bobTotal.total, 6);
  assert.equal(merged.at(-1)!.isUnassigned, true);
  assert.equal(sumCounts(merged).total, 11);
});

test("project stats average over the shown projects and carry the grand total", () => {
  const stats = computeProjectStats(buildProjectRows(CELLS, NONE, NONE));
  assert.equal(stats.numProjects, 2);
  assert.equal(stats.grandTotal, 11);
  assert.equal(stats.avg.total, 5.5);
  assert.deepEqual(computeProjectStats([]).avg.total, 0);
});

test("compareCountRows sorts by a per-priority open column, zeros last, ties fall back to total", () => {
  const base = sumCounts([]);
  const a = { ...base, name: "A", total: 5, open2: 3 };
  const b = { ...base, name: "B", total: 9, open2: 3 };
  const c = { ...base, name: "C", total: 20, open2: 0 };
  const d = { ...base, name: "D", total: 1, open2: 7 };
  const desc = [a, b, c, d].sort((x, y) => compareCountRows(x, y, "open2", "desc")).map((r) => r.name);
  assert.deepEqual(desc, ["D", "B", "A", "C"], "7, then the 3-3 tie broken by higher total, zero sinks");
  const asc = [a, b, c, d].sort((x, y) => compareCountRows(x, y, "open2", "asc")).map((r) => r.name);
  assert.deepEqual(asc, ["B", "A", "D", "C"], "ties still break by higher total when ascending; a zero still sinks to the bottom");
});
