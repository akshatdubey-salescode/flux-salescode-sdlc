// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/template.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellText, normHeader, parseSheetGrid, tabMatchesJiraKey } from "./template";

const HEADER_A = [
  "TEST CASE ID", "TC CLASSIFICATION", "TC TYPE", "Severity", "Priority", "TEST CASE DESCRIPTION",
  "TEST CASE MODULE", "PRECONDITION", "TEST STEP", "EXPECTED RESULT", "Share with Client?",
  "DEV STATUS", "DEV REMARKS", "BA REVIEW", "BA REMARKS", "TESTER REMARKS", "TESTER STATUS",
];
const HEADER_B = [
  "Test Case ID", "Module", "Test Case Title", "Preconditions", "Test Steps", "Expected Result",
  "Remark", "QA Status", "QA Remarks", "Dev Status", "Dev Remarks",
];

const rowA = (id: string, o: Partial<Record<string, string>> = {}) => [
  id, o.cls ?? "Functional", o.type ?? "Positive", o.sev ?? "Critical", o.pri ?? "P1",
  o.title ?? `Scenario ${id}`, o.mod ?? "Delivery", "Pre", "1. Do it\n2. Check", o.exp ?? "It works",
  "Yes", o.dev ?? "", "", "", "", "", o.tester ?? "",
];

test("layout A: columns found by header, values normalised, blank padding rows ignored", () => {
  const grid = [
    HEADER_A,
    rowA("TC_001", { dev: "Passed", tester: "Passed" }),
    rowA("TC_002", { type: "Negative", cls: "Integration", pri: "High", dev: "Blocked - Client Dependency", tester: "Failed" }),
    rowA("TC_003", { type: "Functional", cls: "Data Validation", sev: "Major", dev: "Done - Not Verified" }),
    ...Array.from({ length: 50 }, () => Array(17).fill(null)),
  ];
  const r = parseSheetGrid(grid);
  assert.ok(r.ok);
  assert.equal(r.layout, "A");
  assert.equal(r.headerRow, 1);
  assert.deepEqual(r.cases.map((c) => c.tcId), ["TC_001", "TC_002", "TC_003"]);
  const [a, b, c] = r.cases;
  assert.equal(a.devResult, "pass");
  assert.equal(a.testerResult, "pass");
  assert.equal(b.devResult, "blocked");
  assert.equal(b.testerResult, "fail");
  assert.equal(b.priority, "P1", "High maps to P1");
  assert.equal(b.polarity, "negative");
  assert.equal(c.category, "functional", "TYPE column wins when both columns hold a category");
  assert.equal(c.severity, "major");
  assert.equal(c.devResult, "not_run", "Done - Not Verified is not a pass");
  assert.equal(a.shareWithClient, true);
  assert.equal(a.steps, "1. Do it\n2. Check");
  assert.equal(r.polaritySplit.positive, 1);
  assert.equal(r.polaritySplit.negative, 1, "TC_003 has no polarity in either column");
  assert.equal(r.categorySplit.functional, 2);
  assert.equal(r.categorySplit.integration, 1);
  assert.equal(r.unmapped.length, 0);
});

test("layout B: different headers, QA Status is the tester result, no type falls back to unspecified", () => {
  const grid = [
    HEADER_B,
    ["TC1", "Login", "Valid login", "User exists", "1. Login", "Home opens", "", "Passed", "ok", "Done", "fixed"],
    ["TC2", "Login", "Wrong password", "", "1. Enter wrong pw", "Error shown", "", "Failed", "bug raised", "In Progress", ""],
  ];
  const r = parseSheetGrid(grid);
  assert.ok(r.ok);
  assert.equal(r.layout, "B");
  assert.equal(r.cases[0].title, "Valid login");
  assert.equal(r.cases[0].testerResult, "pass");
  assert.equal(r.cases[0].devResult, "pass");
  assert.equal(r.cases[1].testerResult, "fail");
  assert.equal(r.cases[1].devResult, "not_run");
  assert.equal(r.cases[0].category, "unspecified");
  assert.equal(r.cases[0].testerRemarks, "ok");
  assert.equal(r.cases[0].module, "Login");
});

test("the header need not be on row 1, and newline-split headers are matched", () => {
  const grid = [
    ["Thainamthip test cases"],
    [],
    [...HEADER_A.slice(0, 16), "TESTER STATUS", "TESTER NAME\nDATE\nAPP VERSION"],
    [...rowA("TC_001"), "Asha\n12 Oct\n1.2.3"],
  ];
  const r = parseSheetGrid(grid);
  assert.ok(r.ok);
  assert.equal(r.headerRow, 3);
  assert.equal(r.cases[0].testerMeta, "Asha\n12 Oct\n1.2.3");
  assert.equal(normHeader("TESTER NAME\nDATE\nAPP VERSION"), "tester name date app version");
  assert.equal(normHeader("Share with Client?"), "share with client");
});

test("duplicate IDs are errors; content without an ID and missing fields are warnings", () => {
  const grid = [
    HEADER_A,
    rowA("TC_001"),
    rowA("tc_001"),
    rowA("", { title: "orphan row" }),
    rowA("TC_004", { exp: "" }),
  ];
  const r = parseSheetGrid(grid);
  assert.ok(r.ok);
  assert.equal(r.cases.length, 3, "the ID-less row is skipped");
  const errors = r.issues.filter((i) => i.severity === "error");
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Duplicate Test Case ID/);
  assert.equal(errors[0].row, 3);
  assert.match(errors[0].message, /same section/);
  assert.ok(r.issues.some((i) => i.severity === "warning" && /no Test Case ID/.test(i.message) && i.row === 4));
  assert.ok(r.issues.some((i) => /TC_004: no expected result/.test(i.message)));
});

test("unrecognised values are reported, not dropped", () => {
  const r = parseSheetGrid([
    HEADER_A,
    rowA("TC_001", { cls: "Smoke", pri: "Urgent-ish", tester: "Retest" }),
    rowA("TC_002", { cls: "Smoke" }),
  ]);
  assert.ok(r.ok);
  const smoke = r.unmapped.find((u) => u.field === "Classification");
  assert.equal(smoke?.value, "Smoke");
  assert.equal(smoke?.count, 2);
  assert.ok(r.unmapped.some((u) => u.field === "Priority"));
  assert.ok(r.unmapped.some((u) => u.field === "Tester status" && u.value === "Retest"));
  assert.equal(r.cases[0].category, "other");
});

test("unusable sheets fail with a clear message", () => {
  const none = parseSheetGrid([["foo", "bar"], ["1", "2"]]);
  assert.ok(!none.ok);
  assert.match(none.error, /header row/);
  const empty = parseSheetGrid([HEADER_A]);
  assert.ok(!empty.ok);
  assert.match(empty.error, /no test cases/);
  const noBody = parseSheetGrid([["Test Case ID", "Priority", "Severity", "Remark"], ["1", "P1", "High", "x"]]);
  assert.ok(!noBody.ok);
});

test("cellText handles ExcelJS rich text, formula results, hyperlinks and dates", () => {
  assert.equal(cellText({ richText: [{ text: "a" }, { text: "b" }] }), "ab");
  assert.equal(cellText({ formula: "A1", result: 42 }), "42");
  assert.equal(cellText({ text: "link", hyperlink: "https://x" }), "link");
  assert.equal(cellText(new Date("2026-10-12T05:00:00Z")), "2026-10-12");
  assert.equal(cellText(null), "");
  assert.equal(cellText(7), "7");
});

test("tab names are matched to a Jira key as a whole key", () => {
  assert.ok(tabMatchesJiraKey("CT-614 (Dry Sampling Exclusion)", "CT-614"));
  assert.ok(tabMatchesJiraKey("ct-485", "CT-485"));
  assert.ok(!tabMatchesJiraKey("CT-6140", "CT-614"), "no prefix match");
  assert.ok(!tabMatchesJiraKey("Login", "CT-614"));
  assert.ok(!tabMatchesJiraKey("anything", ""));
});

test("stacked sections: title rows, repeated headers, IDs that restart, even a different column order", () => {
  const grid = [
    ["Promotion Engine", null, null, null, null, null],
    ["TEST CASE ID", "TC TYPE", "TEST CASE DESCRIPTION", "TEST STEP", "EXPECTED RESULT", "DEV STATUS"],
    ["TC-01", "Positive", "Consumes events", "1. send", "consumed", "Passed"],
    ["TC-02", "Negative", "Bad event", "1. send bad", "rejected", ""],
    [],
    // merged title cell: ExcelJS repeats the value across the merged range
    ["Login Backend Logic", "Login Backend Logic", "Login Backend Logic", "Login Backend Logic", "Login Backend Logic", "Login Backend Logic"],
    // a second section with its own column order
    ["Test Case ID", "Module", "Test Case Title", "Preconditions", "Test Steps", "Expected Result", "Status"],
    ["TC_001", "login", "Valid login", "", "1. login", "in", ""],
    ["TC_002", "login", "Invalid login", "", "1. bad pw", "error", ""],
    ["TC_001", "login", "Same ID, second time", "", "1. x", "y", ""],
  ];
  const r = parseSheetGrid(grid);
  assert.ok(r.ok);
  assert.equal(r.cases.length, 5);
  assert.deepEqual(r.sections, [
    { no: 1, title: "Promotion Engine", caseCount: 2 },
    { no: 2, title: "Login Backend Logic", caseCount: 3 },
  ]);
  assert.deepEqual(r.cases.map((c) => c.tcKey), [
    "Promotion Engine / TC-01", "Promotion Engine / TC-02",
    "Login Backend Logic / TC_001", "Login Backend Logic / TC_002", "Login Backend Logic / TC_001",
  ]);
  // The section heading rows are not test cases.
  assert.ok(!r.cases.some((c) => c.tcId.includes("Promotion") || c.tcId.includes("Login Backend")));
  assert.equal(r.cases[0].devResult, "pass");
  assert.equal(r.cases[2].title, "Valid login", "second section parsed with its own column order");
  // TC_001 repeats inside one section: that is a real duplicate, unlike the same ID in another section.
  const errors = r.issues.filter((i) => i.severity === "error");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, 10);
});

test("IDs repeating across sections are fine; a single-section sheet keeps plain IDs as keys", () => {
  const two = parseSheetGrid([
    HEADER_A, rowA("TC_001"),
    ["Second part"],
    HEADER_A, rowA("TC_001"),
  ]);
  assert.ok(two.ok);
  assert.equal(two.issues.filter((i) => i.severity === "error").length, 0);
  assert.equal(new Set(two.cases.map((c) => c.tcKey)).size, 2);

  const one = parseSheetGrid([HEADER_A, rowA("TC_001"), rowA("TC_002")]);
  assert.ok(one.ok);
  assert.deepEqual(one.cases.map((c) => c.tcKey), ["TC_001", "TC_002"]);
});

test("a header whose ID cell is blank is recognised (the first column holds the IDs)", () => {
  const grid = [
    [null, "Module", "Test Case Title", "Test Steps", "Expected Result", "Remark", "QA Status", "QA Remarks"],
    ["TC_UI_01", "Order - Cancel", "Cancel order", "1. open", "popup", null, null, null],
    ["TC_UI_02", "Order - Edit", "Edit order", "1. open", "popup", null, "Failed", null],
  ];
  const r = parseSheetGrid(grid);
  assert.ok(r.ok);
  assert.deepEqual(r.cases.map((c) => c.tcId), ["TC_UI_01", "TC_UI_02"]);
  assert.equal(r.cases[1].testerResult, "fail");
});

test("an ID with nothing else on the row is a stray label, skipped with a warning", () => {
  const r = parseSheetGrid([HEADER_A, rowA("TC_001"), ["Some label", ...Array(16).fill(null)], rowA("TC_002")]);
  assert.ok(r.ok);
  assert.deepEqual(r.cases.map((c) => c.tcId), ["TC_001", "TC_002"]);
  assert.ok(r.issues.some((i) => i.severity === "warning" && /section label/.test(i.message)));
});
