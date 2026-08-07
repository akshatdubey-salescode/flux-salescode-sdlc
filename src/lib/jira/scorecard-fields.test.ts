// Unit tests for performance-review task attribution: Dev Owner ?? Assignee,
// overridden by Assignee whenever hasMatchedLoc is true (a matched PR is
// harder evidence than a Dev Owner field that can go stale — see
// resolveTaskOwnerEmail's own comment for the CAV-2245 case this fixes).
// Run: ./node_modules/.bin/tsx --test src/lib/jira/scorecard-fields.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTaskOwnerEmail } from "./scorecard-fields";

const DEV = ["customfield_10072"]; // a discovered "Dev Owner" field id

test("Dev Owner set (embedded email) → credited to Dev Owner, normalized", () => {
  const cf = { customfield_10072: { emailAddress: "Dev.Owner@Salescode.ai", accountId: "x" } };
  assert.equal(resolveTaskOwnerEmail(cf, DEV, "assignee@salescode.ai"), "dev.owner@salescode.ai");
});

test("Dev Owner set by accountId → resolved via the accountId→email map", () => {
  const cf = { customfield_10072: { accountId: "acc-1" } };
  const map = new Map([["acc-1", "mapped.owner@salescode.ai"]]);
  assert.equal(resolveTaskOwnerEmail(cf, DEV, "assignee@salescode.ai", map), "mapped.owner@salescode.ai");
});

test("Dev Owner as a multi-user array → first entry wins", () => {
  const cf = { customfield_10072: [{ emailAddress: "first@salescode.ai" }, { emailAddress: "second@salescode.ai" }] };
  assert.equal(resolveTaskOwnerEmail(cf, DEV, "assignee@salescode.ai"), "first@salescode.ai");
});

test("Dev Owner not set → falls back to Assignee", () => {
  assert.equal(resolveTaskOwnerEmail({}, DEV, "Assignee@Salescode.ai"), "assignee@salescode.ai");
});

test("no Dev Owner fields discovered → falls back to Assignee", () => {
  const cf = { customfield_10072: { emailAddress: "x@y.ai" } };
  assert.equal(resolveTaskOwnerEmail(cf, [], "assignee@salescode.ai"), "assignee@salescode.ai");
});

test("Dev Owner present but unresolvable (accountId, no map) → falls back to Assignee", () => {
  const cf = { customfield_10072: { accountId: "unknown" } };
  assert.equal(resolveTaskOwnerEmail(cf, DEV, "assignee@salescode.ai"), "assignee@salescode.ai");
});

test("neither Dev Owner nor Assignee → null (credited to nobody)", () => {
  assert.equal(resolveTaskOwnerEmail({}, DEV, null), null);
});

// --- hasMatchedLoc: Assignee wins outright, the CAV-2245 fix ----------------

test("hasMatchedLoc=true overrides a set Dev Owner — Assignee wins", () => {
  const cf = { customfield_10072: { emailAddress: "dev.owner@salescode.ai" } };
  assert.equal(
    resolveTaskOwnerEmail(cf, DEV, "assignee@salescode.ai", null, true),
    "assignee@salescode.ai",
  );
});

test("hasMatchedLoc=false (default) keeps Dev Owner priority — unchanged behavior", () => {
  const cf = { customfield_10072: { emailAddress: "dev.owner@salescode.ai" } };
  assert.equal(resolveTaskOwnerEmail(cf, DEV, "assignee@salescode.ai"), "dev.owner@salescode.ai");
  assert.equal(
    resolveTaskOwnerEmail(cf, DEV, "assignee@salescode.ai", null, false),
    "dev.owner@salescode.ai",
  );
});

test("hasMatchedLoc=true with no Assignee falls back to Dev Owner — never credits nobody just because Assignee is blank", () => {
  const cf = { customfield_10072: { emailAddress: "dev.owner@salescode.ai" } };
  assert.equal(resolveTaskOwnerEmail(cf, DEV, null, null, true), "dev.owner@salescode.ai");
});

test("hasMatchedLoc=true with neither Dev Owner nor Assignee → null", () => {
  assert.equal(resolveTaskOwnerEmail({}, DEV, null, null, true), null);
});
