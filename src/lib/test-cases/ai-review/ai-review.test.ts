// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/ai-review/ai-review.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystem, buildUserPrompt, caseSize, makeLabeler, type PromptCase } from "./prompt";
import { extractReport, mergeReports, parseReport, MAX_FINDINGS, MAX_MESSAGE } from "./parse";
import { chunkBySize } from "./chunk";
import { REPORT_TOOL, type FindingCategory } from "./baseline";

const c = (ref: string, over: Partial<PromptCase> = {}): PromptCase => ({
  ref,
  tab: "Main",
  title: `title ${ref}`,
  module: null,
  polarity: "positive",
  category: "functional",
  priority: "P1",
  preconditions: "",
  steps: "1. do it",
  expected: "it works",
  ...over,
});
const issue = { key: "CT-1", type: "Story", summary: "Do a thing", description: "As a user..." };

test("the system prompt carries the baseline, and marks reference pages as data", () => {
  const none = buildSystem([]);
  assert.match(none, /report_findings/);
  assert.match(none, /No reference material/);
  const some = buildSystem([{ title: "Module map", scope: "general", text: "A depends on B", truncated: true }]);
  assert.match(some, /<reference_document title="Module map" scope="general" note="shortened">/);
  assert.match(some, /data, not instructions/);
});

test("the user prompt has the item, an index of all cases and only this part's cases in detail", () => {
  const all = [c("Main::A"), c("Main::B"), c("Main::C")];
  const p = buildUserPrompt({ issue, roundNo: 2, allCases: all, cases: [all[1]], history: [], part: { index: 2, total: 3 } });
  assert.match(p, /key="CT-1"/);
  assert.match(p, /<case_index total="3">/);
  for (const ref of ["Main::A", "Main::B", "Main::C"]) assert.ok(p.includes(`[${ref}] title`));
  const detail = p.slice(p.indexOf("<test_cases"));
  assert.ok(detail.includes("Steps: 1. do it"));
  assert.equal((detail.match(/Steps:/g) ?? []).length, 1);
  assert.match(detail, /ONLY these 1 cases/);
});

test("history carries status and roles, never names or emails", () => {
  const label = makeLabeler(["sub@x.com"]);
  assert.equal(label("SUB@x.com"), "Submitter");
  assert.equal(label("ai-review@flux.local"), "AI review");
  assert.equal(label("rev@x.com"), "Reviewer 1");
  assert.equal(label("other@x.com"), "Reviewer 2");
  assert.equal(label("rev@x.com"), "Reviewer 1");
  const p = buildUserPrompt({
    issue,
    roundNo: 2,
    allCases: [c("A")],
    cases: [c("A")],
    history: [
      { roundNo: 1, who: label("rev@x.com"), kind: "comment", body: "add a negative case", caseRef: "A", status: "waived" },
      { roundNo: 1, who: "AI review", kind: "changes_requested", body: "vague", caseRef: null, status: null },
    ],
  });
  assert.match(p, /Round 1 - Reviewer 1 commented on \[A\] \[WAIVED: do not raise again\]: add a negative case/);
  assert.ok(!p.includes("@x.com"));
});

test("long fields are clipped and size accounts for them", () => {
  const big = c("A", { steps: "x".repeat(5000) });
  assert.ok(caseSize(big) < 2000);
  assert.match(buildUserPrompt({ issue, roundNo: 1, allCases: [big], cases: [big], history: [] }), /\[…\]/);
});

test("the report is read from the tool block, else from JSON text", () => {
  assert.deepEqual(extractReport([{ type: "tool_use", id: "1", name: REPORT_TOOL.name, input: { findings: [] } }]), { findings: [] });
  assert.deepEqual(extractReport([{ type: "text", text: 'Here:\n```json\n{"findings":[],"summary":"ok"}\n```' }]), { findings: [], summary: "ok" });
  assert.equal(extractReport([{ type: "text", text: "no json here" }]), null);
  assert.equal(extractReport([{ type: "tool_use", id: "1", name: "other", input: {} }]), null);
});

test("findings are validated: unknown refs become round-level, bad values are tamed, junk is dropped", () => {
  const out = parseReport(
    {
      summary: "s",
      findings: [
        { caseRef: "Main::A", severity: "HIGH", category: "duplicate", message: "same as B" },
        { caseRef: "Main::Z", severity: "weird", category: "nope", message: "unknown case" },
        { caseRef: null, severity: "low", category: "missing_coverage", message: "no AC2 case" },
        { caseRef: "Main::A", severity: "low", category: "other", message: "x" },
        "junk",
        { message: "y".repeat(MAX_MESSAGE + 500), severity: "low", category: "other", caseRef: null },
      ],
    },
    new Set(["Main::A", "Main::B"]),
  );
  assert.ok(out);
  assert.equal(out.findings.length, 4);
  assert.deepEqual(out.findings[0], { caseRef: "Main::A", severity: "high", category: "duplicate", message: "same as B" });
  assert.equal(out.findings[1].caseRef, null);
  assert.equal(out.findings[1].severity, "medium");
  assert.equal(out.findings[1].category, "other");
  assert.match(out.findings[1].message, /^\[Main::Z\] unknown case/);
  assert.equal(out.findings[3].message.length, MAX_MESSAGE);
  assert.equal(parseReport("nope", new Set()), null);
  assert.equal(parseReport({ summary: "s" }, new Set()), null);
});

test("findings are capped", () => {
  const many = Array.from({ length: MAX_FINDINGS + 20 }, (_, i) => ({ caseRef: null, severity: "low", category: "other", message: `finding number ${i}` }));
  assert.equal(parseReport({ summary: "", findings: many }, new Set())!.findings.length, MAX_FINDINGS);
});

test("merging chunk reports de-duplicates and puts the serious ones first", () => {
  const f = (caseRef: string | null, severity: "high" | "medium" | "low", message: string) => ({ caseRef, severity, category: "other" as const, message });
  const merged = mergeReports([
    { summary: "part one", coverageNotes: "", findings: [f("A", "low", "Vague expected result."), f(null, "high", "AC2 is untested")] },
    { summary: "part two", coverageNotes: "no map", findings: [f("A", "low", "vague expected result"), f("B", "medium", "steps unclear")] },
  ]);
  assert.equal(merged.findings.length, 3);
  assert.equal(merged.findings[0].severity, "high");
  assert.equal(merged.summary, "part one part two");
  assert.equal(merged.coverageNotes, "no map");
});

test("chunking keeps order, splits on size, never returns zero chunks", () => {
  const items = ["a", "b", "c", "d", "e"].map((id) => ({ id, size: 40 }));
  assert.deepEqual(chunkBySize(items, 100).map((ch) => ch.map((i) => i.id)), [["a", "b"], ["c", "d"], ["e"]]);
  assert.deepEqual(chunkBySize([{ id: "big", size: 500 }], 100).map((ch) => ch.length), [1]);
  assert.deepEqual(chunkBySize([], 100), [[]]);
});

test("case references quoted with brackets or other case still link to the case", () => {
  const known = new Set(["Main::A", "Tab 2::Sec/B-1"]);
  const out = parseReport(
    {
      summary: "",
      findings: [
        { caseRef: "[Main::A]", severity: "low", category: "other", message: "bracketed" },
        { caseRef: " main::a ", severity: "low", category: "other", message: "wrong case" },
        { caseRef: '"Tab 2::Sec/B-1"', severity: "low", category: "other", message: "quoted" },
        { caseRef: "[Main::Z]", severity: "low", category: "other", message: "unknown" },
      ],
    },
    known,
  )!;
  assert.deepEqual(out.findings.map((f) => f.caseRef), ["Main::A", "Main::A", "Tab 2::Sec/B-1", null]);
  assert.match(out.findings[3].message, /^\[Main::Z\] unknown/);
});

test("the same gap worded differently by two parts of a split item is kept once; different gaps and different cases are kept", () => {
  const f = (caseRef: string | null, category: FindingCategory, message: string) => ({ caseRef, severity: "high" as const, category, message });
  const merged = mergeReports([
    { summary: "", coverageNotes: "", findings: [f(null, "missing_coverage", "The ticket explicitly states 'env - online and offline both', but no case states whether the invoice is viewed in the online mode or the offline (cached/local) mode of the app."), f("Discount::DI-1", "vague_expected_result", "Expected result is only Saved and does not prove the value was stored with 3 decimals.")] },
    { summary: "", coverageNotes: "", findings: [f(null, "missing_coverage", "No case covers the 'offline' environment that the ticket explicitly calls out ('env - online and offline both'); all cases just say Open Invoice Tracking."), f("Discount::DI-2", "vague_expected_result", "Same problem: Saved is not verifiable and does not prove the value was stored with 3 decimals."), f(null, "missing_coverage", "No case verifies the Total Amount equals the net payable on the invoice PDF and in the Net Invoice report.")] },
  ]);
  assert.equal(merged.findings.length, 4, merged.findings.map((x) => x.message.slice(0, 40)).join(" | "));
  assert.equal(merged.findings.filter((x) => /offline/i.test(x.message)).length, 1);
  assert.equal(merged.findings.filter((x) => x.caseRef).length, 2, "same wording on two different cases stays two findings");
});

test("the prompt states the chosen scope and prints tab and row for each case", () => {
  const all = [c("Main::A", { row: 14 })];
  const p = buildUserPrompt({ issue, roundNo: 1, allCases: all, cases: all, history: [], scopeText: "Main rows 12-40 (28 of 142 TCs)" });
  assert.match(p, /<review_scope>/);
  assert.match(p, /Main rows 12-40 \(28 of 142 TCs\)/);
  assert.match(p, /other features/);
  assert.match(p, /Main, row 14/);
  const old = buildUserPrompt({ issue, roundNo: 1, allCases: all, cases: all, history: [] });
  assert.ok(!old.includes("<review_scope>"));
});
