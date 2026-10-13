// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/xlsx.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildSnapshotXlsx, loadWorkbook, looksLikeXlsx, safeSheetName, trimGrid, xlsxTabGrid, xlsxTabs } from "./xlsx";
import { parseSheetGrid } from "./template";

const HEADER = ["Test Case ID", "Test Case Title", "Test Steps", "Expected Result", "Dev Status", "Tester Status"];

async function sampleWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet("CT-614 (Dry)");
  a.addRow(HEADER);
  a.addRow(["TC1", "Does X", "1. do", "X done", "Passed", "Failed"]);
  a.addRow([null, null, null, null, null, null]);
  const rich = a.addRow(["TC2", { richText: [{ text: "Rich " }, { text: "title" }] }, "2. do", "ok", "", ""]);
  rich.commit();
  const hidden = wb.addWorksheet("Hidden one");
  hidden.state = "hidden";
  hidden.addRow(["x"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("xlsx magic bytes", async () => {
  assert.ok(looksLikeXlsx(await sampleWorkbook()));
  assert.ok(!looksLikeXlsx(Buffer.from("not a zip at all")));
  assert.ok(!looksLikeXlsx(Buffer.alloc(0)));
});

test("tabs are listed with hidden flags and a tab reads back as a grid the parser understands", async () => {
  const wb = await loadWorkbook(await sampleWorkbook());
  assert.deepEqual(xlsxTabs(wb), [{ title: "CT-614 (Dry)", hidden: false }, { title: "Hidden one", hidden: true }]);
  const parsed = parseSheetGrid(xlsxTabGrid(wb, "CT-614 (Dry)"));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.cases.map((c) => c.tcId), ["TC1", "TC2"]);
  assert.equal(parsed.cases[0].devResult, "pass");
  assert.equal(parsed.cases[0].testerResult, "fail");
  assert.equal(parsed.cases[1].title, "Rich title", "rich text cells are flattened");
});

test("trimGrid drops trailing blank rows and columns only", () => {
  const g = trimGrid([["a", "", "c", ""], ["", "", "", ""], ["d", "e", "", ""], ["", "", "", ""], []]);
  assert.deepEqual(g, [["a", "", "c"], ["", "", ""], ["d", "e", ""]]);
});

test("the snapshot is a single-tab workbook that round-trips through the parser", async () => {
  const wb = await loadWorkbook(await sampleWorkbook());
  const grid = xlsxTabGrid(wb, "CT-614 (Dry)");
  const snap = await buildSnapshotXlsx({ tabTitle: "CT-614 (Dry)", grid, headerRow: 1 });
  assert.ok(looksLikeXlsx(snap));
  const back = await loadWorkbook(snap);
  assert.equal(back.worksheets.length, 1, "no other tabs are carried over");
  const parsed = parseSheetGrid(xlsxTabGrid(back, back.worksheets[0].name));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.cases.map((c) => c.tcId), ["TC1", "TC2"]);
  assert.equal(parsed.cases[0].steps, "1. do");
});

test("sheet names are made Excel-safe", () => {
  assert.equal(safeSheetName("CT-614: a/b?"), "CT-614 a b");
  assert.equal(safeSheetName("x".repeat(50)).length, 31);
  assert.equal(safeSheetName("///"), "Test Cases");
});
