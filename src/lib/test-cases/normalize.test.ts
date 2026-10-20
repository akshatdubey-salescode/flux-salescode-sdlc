// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/normalize.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePriority,
  normalizeResult,
  normalizeSeverity,
  normalizeTypeColumns,
  parseYesNo,
} from "./normalize";

test("type columns are read by value, in either column order", () => {
  // Newer tabs: CLASSIFICATION holds the category, TYPE holds the polarity.
  assert.deepEqual(normalizeTypeColumns("Functional", "Positive"), { polarity: "positive", category: "functional", unmatched: [] });
  // Older tabs: the other way round.
  assert.deepEqual(normalizeTypeColumns("Positive", "Functional"), { polarity: "positive", category: "functional", unmatched: [] });
  assert.deepEqual(normalizeTypeColumns("Edge Case", "Boundary"), { polarity: "edge", category: "boundary", unmatched: [] });
  assert.deepEqual(normalizeTypeColumns("", "Negative"), { polarity: "negative", category: "unspecified", unmatched: [] });
  assert.deepEqual(normalizeTypeColumns(null, null), { polarity: null, category: "unspecified", unmatched: [] });
});

test("category synonyms from the real sheets", () => {
  for (const [raw, cat] of [
    ["UI Validation", "ui"], ["UI/UX", "ui"], ["Data Validation", "data_validation"], ["Validation", "validation"],
    ["Non-Functional", "non_functional"], ["API", "api"], ["Security", "security"], ["Regression", "regression"], ["Integration", "integration"],
  ] as const) {
    assert.equal(normalizeTypeColumns(raw, "Positive").category, cat, raw);
  }
});

test("the TYPE column wins when both columns hold a category; unknown values are reported", () => {
  assert.equal(normalizeTypeColumns("Integration", "Functional").category, "functional");
  assert.equal(normalizeTypeColumns("Functional", "Integration").category, "integration");
  const r = normalizeTypeColumns("Smoke", "Positive");
  assert.deepEqual(r, { polarity: "positive", category: "other", unmatched: [{ column: "classification", value: "Smoke" }] });
  assert.deepEqual(normalizeTypeColumns("Consistency", "").unmatched, [{ column: "classification", value: "Consistency" }]);
});

test("priority accepts P-codes and the High/Medium/Low words used in some tabs", () => {
  assert.equal(normalizePriority("P1").value, "P1");
  assert.equal(normalizePriority("p 2").value, "P2");
  assert.equal(normalizePriority("High").value, "P1");
  assert.equal(normalizePriority("Medium").value, "P2");
  assert.equal(normalizePriority("Low").value, "P3");
  assert.deepEqual(normalizePriority(""), { value: null, matched: true });
  assert.deepEqual(normalizePriority("urgent-ish"), { value: null, matched: false });
});

test("severity covers Critical / High / Major / Medium and synonyms", () => {
  assert.equal(normalizeSeverity("Critical").value, "critical");
  assert.equal(normalizeSeverity("Major").value, "major");
  assert.equal(normalizeSeverity("Minor").value, "low");
  assert.deepEqual(normalizeSeverity("weird"), { value: null, matched: false });
});

test("results: Passed and Done pass; Failed fails; Blocked* blocks; the rest is not run", () => {
  assert.equal(normalizeResult("Passed").value, "pass");
  assert.equal(normalizeResult("Done").value, "pass");
  assert.equal(normalizeResult("Failed").value, "fail");
  assert.equal(normalizeResult("Blocked").value, "blocked");
  assert.equal(normalizeResult("Blocked - Client Dependency").value, "blocked");
  assert.equal(normalizeResult("Blocked – Client Dependency").value, "blocked", "en dash");
  assert.equal(normalizeResult("Done - Not Verified").value, "not_run", "not a pass");
  assert.equal(normalizeResult("In Progress").value, "not_run");
  assert.deepEqual(normalizeResult("Invalid"), { value: "not_run", matched: true }, "an invalid TC is not a pass");
  assert.deepEqual(normalizeResult(""), { value: "not_run", matched: true });
  assert.deepEqual(normalizeResult("Retest"), { value: "not_run", matched: false });
});

test("yes/no", () => {
  assert.equal(parseYesNo("Yes"), true);
  assert.equal(parseYesNo("n"), false);
  assert.equal(parseYesNo(""), null);
  assert.equal(parseYesNo("maybe"), null);
});
