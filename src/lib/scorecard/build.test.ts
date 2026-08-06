// Unit tests for isSelfAssigned — the gate that excludes self-created-and-
// assigned Jiras from every metric in buildScorecards. The rest of build.ts
// is DB-driven (buildScorecards itself) and isn't unit-tested here; this
// covers the one pure decision function it exports.
// Run: ./node_modules/.bin/tsx --test src/lib/scorecard/build.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSelfAssigned } from "./build";

test("reporter same as credited person → self-assigned", () => {
  assert.equal(isSelfAssigned("dev@salescode.ai", "dev@salescode.ai"), true);
});

test("reporter different from credited person → not self-assigned", () => {
  assert.equal(isSelfAssigned("manager@salescode.ai", "dev@salescode.ai"), false);
});

test("comparison is case-insensitive", () => {
  assert.equal(isSelfAssigned("Dev@SalesCode.AI", "dev@salescode.ai"), true);
});

test("comparison tolerates surrounding whitespace on the reporter email", () => {
  assert.equal(isSelfAssigned("  dev@salescode.ai  ", "dev@salescode.ai"), true);
});

test("null reporter → not self-assigned", () => {
  assert.equal(isSelfAssigned(null, "dev@salescode.ai"), false);
});

test("undefined reporter → not self-assigned", () => {
  assert.equal(isSelfAssigned(undefined, "dev@salescode.ai"), false);
});

test("empty-string reporter → not self-assigned", () => {
  assert.equal(isSelfAssigned("", "dev@salescode.ai"), false);
});
