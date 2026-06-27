// Unit tests for performance-review task attribution: Dev Owner ?? Assignee.
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
