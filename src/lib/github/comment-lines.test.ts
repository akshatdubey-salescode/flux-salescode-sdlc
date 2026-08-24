// Unit tests for the patch-level comment-stripping classifier that drives
// code-only LOC (comments excluded) for the Jira Complexity Rating. Run:
// ./node_modules/.bin/tsx --test src/lib/github/comment-lines.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { countPatchCodeLines } from "./comment-lines";

const patch = (lines: string[]) => lines.join("\n");

// --- Unknown extension: no stripping at all ---------------------------------

test("unmapped extension counts every changed line as code, including # lines", () => {
  const p = patch(["+some line", "+# looks like a comment but unknown ext"]);
  assert.deepEqual(countPatchCodeLines("data.proto", p), { additions: 2, deletions: 0 });
});

// --- C-style (//, /* */) ------------------------------------------------------

test("C-style: line comment excluded, code counted", () => {
  const p = patch(["+// a comment", "+const x = 1;"]);
  assert.deepEqual(countPatchCodeLines("a.ts", p), { additions: 1, deletions: 0 });
});

test("C-style: multi-line block comment fully excluded, code on either side counted", () => {
  const p = patch([
    "+/* block comment",
    "+   spanning lines */",
    "+  return sum;",
    "-  return a + b;",
  ]);
  assert.deepEqual(countPatchCodeLines("math.ts", p), { additions: 1, deletions: 1 });
});

test("C-style: trailing inline comment on a code line is left counted as code (documented limitation)", () => {
  const p = patch(["+doThing(); // trailing note"]);
  assert.deepEqual(countPatchCodeLines("a.ts", p), { additions: 1, deletions: 0 });
});

test("C-style: a block comment that opens and closes on the same line, alone, is excluded", () => {
  const p = patch(["+/* just a comment */"]);
  assert.deepEqual(countPatchCodeLines("a.ts", p), { additions: 0, deletions: 0 });
});

test("C-style: a block comment closing mid-line with real code following counts as code (regression: was previously stripped whole)", () => {
  const p = patch(["+/* TODO: revisit */ processPayment(order);"]);
  assert.deepEqual(countPatchCodeLines("a.ts", p), { additions: 1, deletions: 0 });
});

test("C-style: a block comment opened on an earlier line that closes mid-line with code following counts as code", () => {
  const p = patch([
    "+/* still open",
    "+   closes here */ realCode();",
  ]);
  assert.deepEqual(countPatchCodeLines("a.ts", p), { additions: 1, deletions: 0 });
});

test("C-style: blank added/removed lines are counted (only comments are stripped)", () => {
  const p = patch(["+", "-"]);
  assert.deepEqual(countPatchCodeLines("a.ts", p), { additions: 1, deletions: 1 });
});

test("C-style: hunk headers, file headers, and no-newline markers are never counted", () => {
  const p = patch([
    "@@ -1,3 +1,4 @@",
    "--- a/a.ts",
    "+++ b/a.ts",
    "+const x = 1;",
    "\\ No newline at end of file",
  ]);
  assert.deepEqual(countPatchCodeLines("a.ts", p), { additions: 1, deletions: 0 });
});

test("C-style: context lines (space marker) are never counted either way", () => {
  const p = patch([" unchanged();", "+added();"]);
  assert.deepEqual(countPatchCodeLines("a.ts", p), { additions: 1, deletions: 0 });
});

// --- Hash-style (#) -----------------------------------------------------------

test("Python: # comment excluded, code and blank lines counted", () => {
  const p = patch(["+# a comment", "+x = 1", "+"]);
  assert.deepEqual(countPatchCodeLines("script.py", p), { additions: 2, deletions: 0 });
});

test("YAML: # comment excluded", () => {
  const p = patch(["+key: value", "+# a note"]);
  assert.deepEqual(countPatchCodeLines("config.yaml", p), { additions: 1, deletions: 0 });
});

// --- PHP: # comments vs #[Attribute] ------------------------------------------

test("PHP: a bare # line is still a comment", () => {
  const p = patch(["+# a comment", "+$x = 1;"]);
  assert.deepEqual(countPatchCodeLines("a.php", p), { additions: 1, deletions: 0 });
});

test("PHP: a // line is still a comment", () => {
  const p = patch(["+// a comment", "+$x = 1;"]);
  assert.deepEqual(countPatchCodeLines("a.php", p), { additions: 1, deletions: 0 });
});

test("PHP: a #[Attribute] line is real code, not a comment (regression)", () => {
  const p = patch(["+#[Route(\"/api/orders\")]", "+class OrderController {}"]);
  assert.deepEqual(countPatchCodeLines("a.php", p), { additions: 2, deletions: 0 });
});

// --- SQL / Lua (-- line comments) ---------------------------------------------

test("SQL: -- comment excluded, code counted", () => {
  const p = patch(["+-- a note", "+SELECT 1;"]);
  assert.deepEqual(countPatchCodeLines("q.sql", p), { additions: 1, deletions: 0 });
});

test("Lua: -- comment excluded, --[[ ]] block excluded, print() now also excluded as a log call", () => {
  const p = patch(["+-- a note", "+--[[ block", "+   comment ]]", "+print('x')", "+local y = 2"]);
  assert.deepEqual(countPatchCodeLines("a.lua", p), { additions: 1, deletions: 0 });
});

// --- HTML / CSS (block-only, no line tokens) ----------------------------------

test("HTML: <!-- --> comment excluded, markup counted", () => {
  const p = patch(["+<!-- a note -->", "+<div>hi</div>"]);
  assert.deepEqual(countPatchCodeLines("index.html", p), { additions: 1, deletions: 0 });
});

test("CSS: /* */ comment excluded, rule counted", () => {
  const p = patch(["+/* note */", "+.a { color: red; }"]);
  assert.deepEqual(countPatchCodeLines("a.css", p), { additions: 1, deletions: 0 });
});

test("SCSS: // line comment excluded (uses C_STYLE, not a separate duplicate style)", () => {
  const p = patch(["+// note", "+.a { color: red; }"]);
  assert.deepEqual(countPatchCodeLines("a.scss", p), { additions: 1, deletions: 0 });
});

// --- Log statement stripping ---------------------------------------------------

test("TypeScript: console.log excluded, logger.* excluded, real code counted", () => {
  const p = patch(["+console.log(\"x\");", "+logger.info(\"y\");", "+this.logger.debug(\"z\");", "+const x = 1;"]);
  assert.deepEqual(countPatchCodeLines("a.ts", p), { additions: 1, deletions: 0 });
});

test("TypeScript: an awaited/returned log call is still recognized as a log statement", () => {
  const p = patch(["+await logger.flush();", "+return console.log(x);"]);
  assert.deepEqual(countPatchCodeLines("a.ts", p), { additions: 0, deletions: 0 });
});

test("TypeScript: a variable merely named logger/log is not mistaken for a call (no trailing dot)", () => {
  const p = patch(["+const logger = createLogger();", "+logCount++;"]);
  assert.deepEqual(countPatchCodeLines("a.ts", p), { additions: 2, deletions: 0 });
});

test("Java: System.out.println and Log.d excluded, real code counted", () => {
  const p = patch(["+System.out.println(\"x\");", "+Log.d(TAG, \"y\");", "+int total = a + b;"]);
  assert.deepEqual(countPatchCodeLines("a.java", p), { additions: 1, deletions: 0 });
});

test("Go: fmt.Println/log.Printf excluded, fmt.Sprintf is NOT excluded (returns a string, doesn't print)", () => {
  const p = patch(["+fmt.Println(x)", "+log.Printf(\"%d\", x)", "+s := fmt.Sprintf(\"%d\", x)"]);
  assert.deepEqual(countPatchCodeLines("a.go", p), { additions: 1, deletions: 0 });
});

test("Python: print() and logging.* excluded, code counted", () => {
  const p = patch(["+print(x)", "+logging.info(\"y\")", "+self.logger.warning(\"z\")", "+x = 1"]);
  assert.deepEqual(countPatchCodeLines("a.py", p), { additions: 1, deletions: 0 });
});

test("Rust: println!/debug!/dbg! excluded, code counted", () => {
  const p = patch(["+println!(\"{}\", x);", "+debug!(\"y\");", "+dbg!(x);", "+let y = x + 1;"]);
  assert.deepEqual(countPatchCodeLines("a.rs", p), { additions: 1, deletions: 0 });
});

test("C#: Console.WriteLine and _logger excluded, code counted", () => {
  const p = patch(["+Console.WriteLine(x);", "+_logger.LogInformation(\"y\");", "+var total = a + b;"]);
  assert.deepEqual(countPatchCodeLines("a.cs", p), { additions: 1, deletions: 0 });
});

test("unmapped extension: no log prefixes defined, nothing is stripped as a log call", () => {
  const p = patch(["+print(x)"]);
  assert.deepEqual(countPatchCodeLines("data.proto", p), { additions: 1, deletions: 0 });
});

test("a log call and a whole-line comment on the same patch are both excluded independently", () => {
  const p = patch(["+// a comment", "+console.log(x);", "+const y = 2;"]);
  assert.deepEqual(countPatchCodeLines("a.ts", p), { additions: 1, deletions: 0 });
});

// --- Multi-file aggregation (caller sums across files; verify per-call purity) -

test("counts are independent per call — no shared state leaks between files", () => {
  const openEndedComment = patch(["+/* never closes in this file"]);
  const plainCode = patch(["+realCode();"]);
  // If block-comment state leaked across calls, the second call would
  // incorrectly start "inside a comment".
  countPatchCodeLines("a.ts", openEndedComment);
  const second = countPatchCodeLines("b.ts", plainCode);
  assert.deepEqual(second, { additions: 1, deletions: 0 });
});
