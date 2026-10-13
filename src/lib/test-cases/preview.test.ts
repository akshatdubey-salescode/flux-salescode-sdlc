// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/preview.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSheetGrid } from "./template";
import { PREVIEW_ROWS, buildPreview } from "./preview";

const H = ["Test Case ID", "Test Case Title", "Test Steps", "Expected Result", "TC Type", "Priority"];
const row = (id: string, type = "Positive") => [id, `t ${id}`, "s", "e", type, "P1"];

test("a clean sheet previews with counts and a type split, and can be committed", () => {
  const p = buildPreview(parseSheetGrid([H, row("A"), row("B", "Negative"), row("C", "Negative")]));
  assert.ok(p.ok);
  assert.equal(p.caseCount, 3);
  assert.deepEqual(p.polaritySplit, { positive: 1, negative: 2 });
  assert.deepEqual(p.categorySplit, { unspecified: 3 });
  assert.equal(p.sections.length, 1);
  assert.equal(p.canCommit, true);
  assert.equal(p.errorCount, 0);
  assert.equal(p.rows[0].tcId, "A");
});

test("duplicate IDs block the commit and are listed before warnings", () => {
  const p = buildPreview(parseSheetGrid([H, row("A"), row("A"), ["", "orphan", "", "", "", ""]]));
  assert.ok(p.ok);
  assert.equal(p.canCommit, false);
  assert.equal(p.errorCount, 1);
  assert.ok(p.warningCount >= 1);
  assert.equal(p.issues[0].severity, "error");
});

test("only the first rows are previewed; an unusable sheet reports its error", () => {
  const many = [H, ...Array.from({ length: PREVIEW_ROWS + 10 }, (_, i) => row(`T${i}`))];
  const p = buildPreview(parseSheetGrid(many));
  assert.ok(p.ok);
  assert.equal(p.caseCount, PREVIEW_ROWS + 10);
  assert.equal(p.rows.length, PREVIEW_ROWS);

  const bad = buildPreview(parseSheetGrid([["nope"]]));
  assert.ok(!bad.ok);
  assert.match(bad.error, /header row/);
});
