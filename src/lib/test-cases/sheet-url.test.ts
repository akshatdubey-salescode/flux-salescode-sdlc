// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/sheet-url.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSheetUrl, sheetUrlFor } from "./sheet-url";

const ID = "1ZOYDvESrZxohOusFjU-grVc-QcU7EB-CCedwakLBabc";

test("accepts Google Sheets links and extracts the ID and tab", () => {
  assert.deepEqual(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=123456`), { spreadsheetId: ID, gid: 123456 });
  assert.deepEqual(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=9`), { spreadsheetId: ID, gid: 9 });
  assert.deepEqual(parseSheetUrl(`  https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing  `), { spreadsheetId: ID, gid: null });
  assert.deepEqual(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}`), { spreadsheetId: ID, gid: null });
});

test("rejects everything that is not an https docs.google.com spreadsheet", () => {
  assert.equal(parseSheetUrl("not a url"), null);
  assert.equal(parseSheetUrl(`http://docs.google.com/spreadsheets/d/${ID}/edit`), null, "http");
  assert.equal(parseSheetUrl(`https://evil.example/spreadsheets/d/${ID}/edit`), null, "other host");
  assert.equal(parseSheetUrl(`https://docs.google.com.evil.example/spreadsheets/d/${ID}/edit`), null, "lookalike host");
  assert.equal(parseSheetUrl(`https://docs.google.com/document/d/${ID}/edit`), null, "a doc, not a sheet");
  assert.equal(parseSheetUrl("https://docs.google.com/spreadsheets/d/short/edit"), null, "implausible ID");
  assert.equal(parseSheetUrl(`https://user:pw@docs.google.com/spreadsheets/d/${ID}/edit`)?.spreadsheetId, ID, "credentials are ignored, host is still google");
});

test("the canonical link is rebuilt from the parsed parts", () => {
  assert.equal(sheetUrlFor(ID, 5), `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=5`);
  assert.equal(sheetUrlFor(ID, null), `https://docs.google.com/spreadsheets/d/${ID}/edit`);
});
