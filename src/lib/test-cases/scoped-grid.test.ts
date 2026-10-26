// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/scoped-grid.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTabs } from "./multi-tab";
import { parseRowSpec } from "./scope";
import { contentHash } from "./content-hash";
import { buildRoundScope, scopedGrids } from "./scoped-grid";

const H = ["Test Case ID", "Test Case Title", "Test Steps", "Expected Result", "TC Type", "Priority"];
const row = (id: string, title = `t ${id}`) => [id, title, "s", "e", "Positive", "P1"];
// Two sections: Login (title row 1, header 2, cases 3-5), Orders (title 7, header 8, cases 9-11).
const grid = () => [["Login"], H, row("L1"), row("L2"), row("L3"), [], ["Orders"], H, row("O1"), row("O2"), row("O3")];
const scope = (tab: string, spec: string) => {
  const r = parseRowSpec(spec);
  assert.ok(r.ok);
  return new Map([[tab, r.ok ? r.ranges : null]]);
};
const parsedOk = (tabs: { title: string; grid: unknown[][] }[], sc?: ReturnType<typeof scope>, skipNonTc = false) => {
  const p = parseTabs(tabs, { scope: sc, skipNonTc });
  assert.ok(p.ok);
  return p;
};

test("rows outside the chosen ones are blanked, row numbers stay, the in-scope sections keep their header and title rows", () => {
  const tabs = [{ title: "Main", grid: grid() }];
  const p = parsedOk(tabs, scope("Main", "9-10"));
  const [g] = scopedGrids(tabs, p);
  assert.equal(g.grid.length, 11, "geometry kept");
  assert.deepEqual(g.grid[8], row("O1"));
  assert.deepEqual(g.grid[9], row("O2"));
  assert.deepEqual(g.grid[10], [], "O3 is outside");
  assert.deepEqual(g.grid[6], ["Orders"], "title row of the section in scope");
  assert.deepEqual(g.grid[7], H, "its header row");
  for (const i of [0, 1, 2, 3, 4]) assert.deepEqual(g.grid[i], [], `row ${i + 1} belongs to Login, which is not in scope`);
});

test("a tab read whole is untouched, and tabs that were skipped are not stored", () => {
  const tabs = [{ title: "Cover", grid: [["x"]] }, { title: "Main", grid: grid() }];
  const p = parsedOk(tabs, undefined, true);
  const out = scopedGrids(tabs, p);
  assert.deepEqual(out.map((g) => g.title), ["Main"]);
  assert.equal(out[0].grid, tabs[1].grid);
});

test("the fingerprint ignores edits to rows outside the scope and notices edits inside it", () => {
  const a = [{ title: "Main", grid: grid() }];
  const outsideEdited = grid();
  outsideEdited[2] = row("L1", "someone else changed this");
  const b = [{ title: "Main", grid: outsideEdited }];
  const insideEdited = grid();
  insideEdited[8] = row("O1", "changed inside the scope");
  const c = [{ title: "Main", grid: insideEdited }];
  const sc = scope("Main", "9-11");
  const hash = (tabs: typeof a) => contentHash(scopedGrids(tabs, parsedOk(tabs, sc)));
  assert.equal(hash(a), hash(b));
  assert.notEqual(hash(a), hash(c));
});

test("the round's scope records rows, counts, first and last test case and the tab id", () => {
  const tabs = [{ title: "Main", grid: grid() }, { title: "Extra", grid: [H, row("E1"), row("E2")] }];
  const p = parsedOk(tabs, scope("Main", "9-11"));
  const rs = buildRoundScope(p, { defaulted: false, gids: new Map([["Main", 77], ["Extra", 88]]) });
  assert.equal(rs.defaulted, false);
  const main = rs.tabs.find((t) => t.tab === "Main")!;
  assert.deepEqual([main.rows, main.gid, main.totalInTab, main.inScope, main.firstId, main.lastId, main.firstRow, main.lastRow], ["9-11", 77, 6, 3, "O1", "O3", 9, 11]);
  const extra = rs.tabs.find((t) => t.tab === "Extra")!;
  assert.deepEqual([extra.rows, extra.ranges, extra.totalInTab, extra.inScope], [null, null, 2, 2]);
});
