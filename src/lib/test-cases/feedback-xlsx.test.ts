// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/feedback-xlsx.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildFeedbackXlsx, safeCell } from "./feedback-xlsx";

test("formula-looking text is kept as text", () => {
  assert.equal(safeCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(safeCell("+1"), "'+1");
  assert.equal(safeCell("-2"), "'-2");
  assert.equal(safeCell("@cmd"), "'@cmd");
  assert.equal(safeCell("normal text"), "normal text");
  assert.equal(safeCell(""), "");
});

test("the workbook has a summary of decisions and one row per piece of feedback", async () => {
  const buf = await buildFeedbackXlsx({
    issueKey: "CT-614",
    issueSummary: "Dry Sampling Exclusion",
    roundLabel: "Round 2, 14 Oct 2026 15:42 IST",
    generatedAt: "14 Oct 2026 16:00 IST",
    scopeText: "Main rows 12-40 (28 of 142 TCs)",
    reviewers: [
      { name: "Asha", email: "asha@salescode.ai", state: "changes_requested", decidedAt: "14 Oct 2026 15:50 IST" },
      { name: null, email: "bo@salescode.ai", state: "pending", decidedAt: null },
    ],
    rows: [
      { scope: "Round", tab: null, row: null, section: null, tcCode: null, title: null, kind: "changes_requested", body: "Add negative cases", author: "Asha", at: "14 Oct 2026 15:50 IST", resolved: false },
      { scope: "Test case", tab: "Main", row: 23, section: "Promotion Engine", tcCode: "TC-02", title: "Bad event", kind: "comment", body: "=cmd|' /C calc'!A0", author: "Asha", at: "14 Oct 2026 15:49 IST", resolved: true },
    ],
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Summary", "Feedback"]);

  const summary = wb.getWorksheet("Summary")!;
  assert.equal(summary.getCell("B1").value, "CT-614 — Dry Sampling Exclusion");
  assert.equal(summary.getCell("B3").value, "Main rows 12-40 (28 of 142 TCs)", "what the round reviewed is stated");
  assert.equal(summary.getCell("C7").value, "Changes requested");
  assert.equal(summary.getCell("C8").value, "Pending review");

  const fb = wb.getWorksheet("Feedback")!;
  assert.equal(fb.rowCount, 3);
  assert.equal(fb.getCell("G2").value, "Changes requested");
  assert.equal(fb.getCell("B3").value, "Main", "the tab of a per-test-case comment");
  assert.equal(fb.getCell("C3").value, 23, "and its row in the sheet");
  assert.equal(fb.getCell("E3").value, "TC-02");
  assert.equal(fb.getCell("H3").value, "'=cmd|' /C calc'!A0", "a formula injection attempt stays text");
  assert.equal(fb.getCell("K3").value, "Yes");
});
