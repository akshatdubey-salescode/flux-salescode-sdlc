// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/lock.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLock, type ItemLock } from "./lock";

const sheet: ItemLock = { source: "google_sheet", sheetUrl: "https://docs.google.com/spreadsheets/d/AAA/edit", spreadsheetId: "AAA", tabs: ["Main"], roundNo: 1, scope: null };
const xlsx: ItemLock = { source: "xlsx", sheetUrl: null, spreadsheetId: null, tabs: ["Main"], roundNo: 1, scope: null };

test("the first submission is free to choose its source", () => {
  assert.deepEqual(checkLock(null, { source: "google_sheet", spreadsheetId: "ZZZ" }), { ok: true });
  assert.deepEqual(checkLock(null, { source: "xlsx", spreadsheetId: null }), { ok: true });
});

test("resubmitting the same sheet, or another workbook upload, is fine", () => {
  assert.deepEqual(checkLock(sheet, { source: "google_sheet", spreadsheetId: "AAA" }), { ok: true });
  assert.deepEqual(checkLock(xlsx, { source: "xlsx", spreadsheetId: null }), { ok: true });
});

test("a different Google Sheet is rejected and the message names the original link", () => {
  const v = checkLock(sheet, { source: "google_sheet", spreadsheetId: "BBB" });
  assert.equal(v.ok, false);
  assert.match((v as { reason: string }).reason, /already uses a different Google Sheet \(https:\/\/docs\.google\.com\/spreadsheets\/d\/AAA/);
  assert.match((v as { reason: string }).reason, /admin has to delete/);
});

test("switching source in either direction is rejected with a way forward", () => {
  const toXlsx = checkLock(sheet, { source: "xlsx", spreadsheetId: null });
  assert.match((toXlsx as { reason: string }).reason, /come from a Google Sheet.*Edit the sheet and resubmit/);
  const toSheet = checkLock(xlsx, { source: "google_sheet", spreadsheetId: "AAA" });
  assert.match((toSheet as { reason: string }).reason, /Excel upload.*Download the current workbook/);
});
