// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/summary-xlsx.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { computeSetStats, type AnalyticsCase } from "./analytics";
import { buildSummaryXlsx } from "./summary-xlsx";

const mk = (id: string, over: Partial<AnalyticsCase> = {}): AnalyticsCase => ({
  tcCode: id, title: `Case ${id}`, steps: "do it", expected: "works", priority: "P1", severity: "high",
  category: "functional", polarity: "positive", devResult: "pass", testerResult: null, ...over,
});

async function load(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

test("the workbook carries the headline numbers, splits, sign-offs and every case", async () => {
  const cases = [mk("TC-01"), mk("TC-02", { devResult: "fail", polarity: "negative" }), mk("TC-03", { devResult: "not_run" })];
  const stats = computeSetStats({
    cases, roundStatus: "approved", reviewersTotal: 1, reviewersApproved: 1,
    hasDevSignoff: true, hasTesterSignoff: false, feedbackTotal: 2, feedbackOpen: 1, roundCount: 1,
  });
  const buf = await buildSummaryXlsx({
    issueKey: "CT-1", issueSummary: "=HYPERLINK(\"x\")", projectName: "P", roundLabel: "Round 1", generatedAt: "now", stats,
    trend: [{ roundNo: 1, tcCount: 3, quality: stats.quality, passRate: stats.passRate, confidence: stats.confidence, status: "approved" }],
    signoffs: [{ role: "dev", by: "A", label: "x", pass: 1, fail: 1, blocked: 0, notRun: 1, notes: null, current: true }],
    cases: cases.map((c) => ({
      section: null, tcCode: c.tcCode, title: c.title, category: c.category, polarity: c.polarity, priority: c.priority, severity: c.severity,
      dev: c.devResult, tester: c.testerResult, effective: c.devResult ?? "not_run",
    })),
  });

  const wb = await load(buf);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Summary", "Breakdown", "Rounds", "Sign-offs", "Cases"]);

  const summary = wb.getWorksheet("Summary")!;
  const find = (label: string) => summary.getRows(1, summary.rowCount)!.find((r) => r.getCell(1).value === label)?.getCell(2).value;
  assert.equal(find("Delivery confidence"), `${stats.confidence}%`);
  assert.equal(find("Test cases"), 3);
  assert.equal(find("Failed"), 1);
  assert.equal(find("Developer signed off"), "Yes");
  assert.equal(find("Tester signed off"), "No");

  // Only a leading = + - @ makes a cell a formula; this one starts with the key.
  assert.equal(find("Issue"), 'CT-1 — =HYPERLINK("x")');

  const cs = wb.getWorksheet("Cases")!;
  assert.equal(cs.rowCount, 4);
  assert.equal(cs.getRow(3).getCell(8).value, "Failed");
  assert.equal(cs.getRow(3).getCell(9).value, "No sign-off");
});

test("a value that would be a formula is escaped", async () => {
  const stats = computeSetStats({
    cases: [mk("TC-01")], roundStatus: "in_review", reviewersTotal: 0, reviewersApproved: 0,
    hasDevSignoff: false, hasTesterSignoff: false, feedbackTotal: 0, feedbackOpen: 0, roundCount: 1,
  });
  const buf = await buildSummaryXlsx({
    issueKey: "CT-1", issueSummary: "s", projectName: "=cmd", roundLabel: "R", generatedAt: "n", stats, trend: [], signoffs: [],
    cases: [{ section: null, tcCode: "TC-01", title: "+SUM(A1)", category: "functional", polarity: null, priority: null, severity: null, dev: null, tester: null, effective: "not_run" }],
  });
  const wb = await load(buf);
  const summary = wb.getWorksheet("Summary")!;
  assert.equal(summary.getRow(2).getCell(2).value, "'=cmd");
  assert.equal(wb.getWorksheet("Cases")!.getRow(2).getCell(3).value, "'+SUM(A1)");
});
