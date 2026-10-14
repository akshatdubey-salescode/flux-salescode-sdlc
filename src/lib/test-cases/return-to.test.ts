// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/return-to.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeReturnTo, withReturnTo } from "./return-to";

test("same-site relative paths are accepted, including their query", () => {
  assert.equal(safeReturnTo("/projects/abc?tab=delivery-tracker"), "/projects/abc?tab=delivery-tracker");
});

test("anything that could leave the site or is malformed is rejected", () => {
  for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "projects/abc", "", "   ", null, undefined, 42, "/a\nb", "/" + "x".repeat(600)]) {
    assert.equal(safeReturnTo(bad), null, String(bad));
  }
});

test("withReturnTo adds an encoded from param, respecting an existing query", () => {
  assert.equal(withReturnTo("/test-cases/new?issue=1", "/projects/p?tab=sprint-tracker"), "/test-cases/new?issue=1&from=%2Fprojects%2Fp%3Ftab%3Dsprint-tracker");
  assert.equal(withReturnTo("/test-cases/abc", "/home"), "/test-cases/abc?from=%2Fhome");
  assert.equal(withReturnTo("/test-cases/abc", "https://evil.com"), "/test-cases/abc");
  assert.equal(withReturnTo("/test-cases/abc", null), "/test-cases/abc");
});

test("the back label names the tab the user came from", async () => {
  const { returnLabel } = await import("./return-to");
  assert.equal(returnLabel("/projects/p?tab=delivery-tracker"), "Back to Delivery Tracking");
  assert.equal(returnLabel("/projects/p?tab=sprint-tracker"), "Back to Sprint Tracking");
  assert.equal(returnLabel("/home"), "Back");
  assert.equal(returnLabel("https://evil.com"), "Back");
  assert.equal(returnLabel(null), "Back");
});
