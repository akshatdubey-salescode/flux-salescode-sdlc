// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/signoff-diagnose.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTabs, type TabGrid } from "./multi-tab";
import { matchSignoff, type RoundCaseRef } from "./signoff";
import { columnLetter, explainSignoffProblem } from "./signoff-diagnose";

const BASE = ["Test Case ID", "TC Classification", "TC Type", "Test Case Description", "Test Steps", "Expected Result"];
const caseRow = (id: string, extra: string[]) => [id, "Positive", "Functional", `Scenario ${id}`, "1. do", "ok", ...extra];

function setup(header: string[], rows: string[][], tab = "HFC-1040") {
  const grids: TabGrid[] = [{ title: tab, grid: [header, ...rows] }];
  const parsed = parseTabs(grids, { uncapped: true });
  assert.ok(parsed.ok);
  const refs: RoundCaseRef[] = parsed.cases.map((c, i) => ({ id: `c${i}`, tcKey: c.tcKey, tcCode: c.tcId }));
  return { grids, parsed, refs };
}
const explain = (role: "dev" | "tester", s: ReturnType<typeof setup>, refs = s.refs) =>
  explainSignoffProblem({ role, match: matchSignoff(refs, s.parsed.cases, role), refs, parsed: s.parsed, grids: s.grids });

test("no Dev Status column: names what Flux looks for and lists the columns the sheet has", () => {
  const s = setup([...BASE, "Tester Status"], [caseRow("TC_01", ["Passed"]), caseRow("TC_02", ["Passed"])]);
  const msg = explain("dev", s)!;
  assert.match(msg, /No developer status column was found/);
  assert.match(msg, /"Dev Status"/);
  assert.match(msg, /"Developer Status"/);
  assert.match(msg, /HFC-1040: A "Test Case ID"/);
  assert.match(msg, /G "Tester Status"/, "columns are shown with their letters");
  assert.match(msg, /Add a column with one of those headings/);
});

test("the column exists but is empty: says which column and how many test cases", () => {
  const s = setup([...BASE, "Dev Status"], [caseRow("TC_01", [""]), caseRow("TC_02", [""]), caseRow("TC_03", [""])]);
  const msg = explain("dev", s)!;
  assert.match(msg, /found \("Dev Status" \(column G of tab "HFC-1040"\)\)|"Dev Status" \(column G of tab "HFC-1040"\)/);
  assert.match(msg, /empty for all 3 test cases/);
});

test("values that Flux does not understand are listed with counts", () => {
  const s = setup([...BASE, "Dev Status"], [caseRow("TC_01", ["Looks fine"]), caseRow("TC_02", ["looks fine"]), caseRow("TC_03", ["Ok"])]);
  const msg = explain("dev", s)!;
  assert.match(msg, /none is a status Flux understands/);
  assert.match(msg, /"Looks fine" × 2/);
  assert.match(msg, /"Ok" × 1/);
  assert.match(msg, /Passed, Failed, Blocked or Not run/);
});

test("statuses that all mean 'not run' are explained as such", () => {
  const s = setup([...BASE, "Tester Status"], [caseRow("TC_01", ["Not Executed"]), caseRow("TC_02", ["Pending"])]);
  const msg = explain("tester", s)!;
  assert.match(msg, /every one reads as "Not run"/);
  assert.match(msg, /"Not Executed" × 1/);
  assert.match(msg, /"Pending" × 1/);
});

test("the other role's column is not mistaken for this one", () => {
  const s = setup([...BASE, "Tester Status"], [caseRow("TC_01", ["Passed"])]);
  assert.equal(explain("tester", s), null, "tester sign-off works");
  assert.match(explain("dev", s)!, /No developer status column/);
});

test("IDs that do not match the approved round: shows expected and found IDs", () => {
  const s = setup([...BASE, "Dev Status"], [caseRow("X-1", ["Passed"]), caseRow("X-2", ["Passed"])]);
  const approved: RoundCaseRef[] = [{ id: "a", tcKey: "HFC-1040::TC_01", tcCode: "TC_01" }, { id: "b", tcKey: "HFC-1040::TC_02", tcCode: "TC_02" }];
  const msg = explain("dev", s, approved)!;
  assert.match(msg, /None of the 2 test cases of the approved round were found/);
  assert.match(msg, /TC_01, TC_02/);
  assert.match(msg, /X-1, X-2/);
  assert.match(msg, /tabs "HFC-1040"/);
});

test("a usable sign-off has no problem", () => {
  const s = setup([...BASE, "Dev Status"], [caseRow("TC_01", ["Passed"]), caseRow("TC_02", [""])]);
  assert.equal(explain("dev", s), null);
});

test("new header spellings are read as the status columns", () => {
  const s = setup([...BASE, "Developer Status", "Testing Status"], [caseRow("TC_01", ["Passed", "Failed"])]);
  assert.equal(s.parsed.cases[0].devResult, "pass");
  assert.equal(s.parsed.cases[0].testerResult, "fail");
  // The team's template calls the developer's column "Dev Review" (HFC-1040's sheet has no "Dev Status").
  const t = setup([...BASE, "BA Review", "Dev Review", "Tester Status"], [caseRow("TC_01", ["Reviewed", "Passed", "Passed"])]);
  assert.equal(t.parsed.cases[0].devResult, "pass");
  assert.equal(explain("dev", t), null);
});

test("columnLetter", () => {
  assert.deepEqual([0, 6, 25, 26, 27, 701, 702].map(columnLetter), ["A", "G", "Z", "AA", "AB", "ZZ", "AAA"]);
});

test("two columns for the same status: the one with a real result is read, whatever its position or letter case", () => {
  // The old "Dev Review" is empty and a new "DEV STATUS" was added at the end; the old "Tester Status" still says Not Executed
  // next to a new "TESTER STATUS".
  const s = setup(
    [...BASE, "Dev Review", "Tester Status", "DEV STATUS", "TESTER STATUS"],
    [caseRow("TC_01", ["", "Not Executed", "Passed", "Failed"]), caseRow("TC_02", ["", "Not Executed", "Blocked - client", "passed"])],
  );
  assert.deepEqual(s.parsed.cases.map((c) => [c.devResult, c.testerResult]), [["pass", "fail"], ["blocked", "pass"]]);
  assert.equal(explain("dev", s), null);
  assert.equal(explain("tester", s), null);
});

test("when several columns exist but none has a result, the error names them all", () => {
  const s = setup([...BASE, "Dev Review", "DEV STATUS"], [caseRow("TC_01", ["", ""]), caseRow("TC_02", ["", ""])]);
  const msg = explain("dev", s)!;
  assert.match(msg, /More than one column holds the developer status/);
  assert.match(msg, /G "Dev Review", H "DEV STATUS"/);
});

test("the first column with any text is kept when no column has a real result (so unknown words are still reported)", () => {
  const s = setup([...BASE, "Dev Status", "Dev Review"], [caseRow("TC_01", ["Looks fine", "Ok"])]);
  assert.equal(s.parsed.cases[0].devStatus, "Looks fine");
});
