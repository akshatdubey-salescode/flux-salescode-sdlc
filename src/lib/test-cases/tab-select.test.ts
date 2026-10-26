// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/tab-select.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { sortTabsByName, chooseTab, pickTabs, type TabInfo } from "./tab-select";

const tabs: TabInfo[] = [
  { title: "TESTCASES Summary", hidden: false, sheetId: 0 },
  { title: "CT-485", hidden: false, sheetId: 11 },
  { title: "CT-614 (Dry Sampling Exclusion)", hidden: false, sheetId: 22 },
  { title: "Login ", hidden: false, sheetId: 33 },
  { title: "Stock Threshold", hidden: true, sheetId: 44 },
];

test("an explicit choice wins, but only if it is a visible tab", () => {
  assert.equal(chooseTab({ tabs, requested: "Login ", jiraKey: "CT-614" }), "Login ");
  assert.equal(chooseTab({ tabs, requested: "Stock Threshold", jiraKey: "CT-614" }), null, "hidden");
  assert.equal(chooseTab({ tabs, requested: "Nope", jiraKey: "CT-614" }), null);
});

test("the link's gid selects its tab", () => {
  assert.equal(chooseTab({ tabs, gid: 33, jiraKey: "CT-614" }), "Login ");
  assert.equal(chooseTab({ tabs, gid: 44, jiraKey: "CT-614" }), "CT-614 (Dry Sampling Exclusion)", "hidden gid falls through to the key match");
});

test("a single visible tab is chosen automatically", () => {
  assert.equal(chooseTab({ tabs: [{ title: "Sheet1", hidden: false }, { title: "x", hidden: true }], jiraKey: "ABC-1" }), "Sheet1");
});

test("otherwise the one tab named after the Jira key; ambiguous or none means the user picks", () => {
  assert.equal(chooseTab({ tabs, jiraKey: "CT-614" }), "CT-614 (Dry Sampling Exclusion)");
  assert.equal(chooseTab({ tabs, jiraKey: "CT-485" }), "CT-485");
  assert.equal(chooseTab({ tabs, jiraKey: "ZZ-1" }), null);
  const dup: TabInfo[] = [{ title: "CT-1 a", hidden: false }, { title: "CT-1 b", hidden: false }];
  assert.equal(chooseTab({ tabs: dup, jiraKey: "CT-1" }), null, "two matches is ambiguous");
});


const ALL_VISIBLE = ["TESTCASES Summary", "CT-485", "CT-614 (Dry Sampling Exclusion)", "Login "];

test("pickTabs: an explicit list wins and every entry must be a visible tab", () => {
  const ok = pickTabs({ tabs, requested: ["CT-485", "Login "], jiraKey: "CT-614" });
  assert.deepEqual(ok, { ok: true, selected: ["CT-485", "Login "], missingPrevious: [], defaulted: false });
  assert.deepEqual(pickTabs({ tabs, requested: ["CT-485", "Stock Threshold"], jiraKey: "CT-614" }), { ok: false, missing: "Stock Threshold" });
  assert.deepEqual(pickTabs({ tabs, requested: ["CT-485", "CT-485"], jiraKey: "x" }).ok && (pickTabs({ tabs, requested: ["CT-485", "CT-485"], jiraKey: "x" }) as { selected: string[] }).selected, ["CT-485"], "repeats collapse");
});

test("pickTabs: clearing every tab means none was named, so all visible tabs are taken (and flagged)", () => {
  assert.deepEqual(pickTabs({ tabs, requested: [], jiraKey: "CT-614" }), { ok: true, selected: ALL_VISIBLE, missingPrevious: [], defaulted: true });
});

test("pickTabs: a resubmission starts from the previous tabs and reports any that vanished", () => {
  const r = pickTabs({ tabs, previous: ["CT-485", "Gone tab"], jiraKey: "CT-614" });
  assert.deepEqual(r, { ok: true, selected: ["CT-485"], missingPrevious: ["Gone tab"], defaulted: false });
});

test("pickTabs: a first submission with nothing named takes the link's gid tab, the only tab, else ALL visible tabs", () => {
  assert.deepEqual(pickTabs({ tabs, gid: 33, jiraKey: "ZZ-9" }), { ok: true, selected: ["Login "], missingPrevious: [], defaulted: false });
  assert.deepEqual(pickTabs({ tabs: [{ title: "Sheet1", hidden: false }, { title: "x", hidden: true }], jiraKey: "ABC-1" }), { ok: true, selected: ["Sheet1"], missingPrevious: [], defaulted: false });
  // A tab named after the Jira key is only a suggestion now: it no longer narrows the review.
  assert.deepEqual(pickTabs({ tabs, jiraKey: "CT-614" }), { ok: true, selected: ALL_VISIBLE, missingPrevious: [], defaulted: true });
  assert.deepEqual(pickTabs({ tabs, jiraKey: "ZZ-9" }), { ok: true, selected: ALL_VISIBLE, missingPrevious: [], defaulted: true });
  assert.equal(chooseTab({ tabs, jiraKey: "CT-614" }), "CT-614 (Dry Sampling Exclusion)", "the badge still points at it");
});

test("pickTabs: previous tabs that all vanished fall through to all visible tabs", () => {
  assert.deepEqual(pickTabs({ tabs, previous: ["Gone"], jiraKey: "ZZ-9" }), { ok: true, selected: ALL_VISIBLE, missingPrevious: ["Gone"], defaulted: true });
});

test("sortTabsByName: alphabetical, case-insensitive, numbers by value, input untouched", () => {
  const input = [{ title: "Tab 10" }, { title: "zeta" }, { title: " New one" }, { title: "Tab 2" }, { title: "Alpha" }, { title: "beta" }];
  const sorted = sortTabsByName(input).map((t) => t.title);
  assert.deepEqual(sorted, ["Alpha", "beta", " New one", "Tab 2", "Tab 10", "zeta"]);
  assert.equal(input[0].title, "Tab 10");
});
