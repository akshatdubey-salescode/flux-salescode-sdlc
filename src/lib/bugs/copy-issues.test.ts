// Unit tests for the Bug Board "Copy Issues" message.
//
// Run: ./node_modules/.bin/tsx --test "src/lib/bugs/copy-issues.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIssuesMessage, RCA_EXCERPT_MAX, type CopyIssue } from "./copy-issues";

function issue(over: Partial<CopyIssue> = {}): CopyIssue {
  return {
    jiraKey: "CAV-1", summary: "Order not visible", priority: "P1", status: "Open",
    projectName: "CavinKare COE", jiraBaseUrl: "https://jira.example/", environment: "Prod",
    isCustomerFound: true, ownerName: "Rohit Mittal", assigneeName: "Anish Raj",
    createdAt: "2026-10-02T08:30:00.000Z", ...over,
  };
}

const TODAY = "2026-10-07";

test("header, scope, range, filters and per-issue block with Jira link", () => {
  const msg = buildIssuesMessage({
    title: "CavinKare COE — Rohit Mittal — P1", from: "2026-09-07", to: "2026-10-06",
    env: "Prod", cfOnly: true, issues: [issue()], rca: { "CAV-1": { given: true, text: "Race in cart" } }, today: TODAY,
  });
  assert.match(msg, /^🐞 Bug Report — 7 Oct 2026\nCavinKare COE — Rohit Mittal — P1\n/);
  assert.match(msg, /Raised: 7 Sep 2026 → 6 Oct 2026/);
  assert.match(msg, /Filters: Env: Prod · Customer-found only/);
  assert.match(msg, /1 issue · RCA given: 1 · not given: 0/);
  assert.match(msg, /1\. CAV-1 — Order not visible\n   CavinKare COE · P1 · Open · Prod · Customer-found\n   Owner: Rohit Mittal · Assignee: Anish Raj · Raised: 2 Oct 2026\n   RCA: Race in cart\n   https:\/\/jira\.example\/browse\/CAV-1$/);
});

test("priority mix, RCA tally, missing owner and QA-found are reported", () => {
  const msg = buildIssuesMessage({
    title: "All", issues: [
      issue({ jiraKey: "A-1", priority: "P1" }),
      issue({ jiraKey: "A-2", priority: "P3", ownerName: null, assigneeName: null, isCustomerFound: false, environment: "—", createdAt: null }),
    ],
    rca: { "A-1": { given: true, text: null }, "A-2": { given: false, text: null } }, today: TODAY,
  });
  assert.match(msg, /2 issues · P1: 1, P3: 1 · RCA given: 1 · not given: 1/);
  assert.match(msg, /Owner: Missing Issue Owner\n/);
  assert.match(msg, /A-2 — Order not visible\n   CavinKare COE · P3 · Open · QA-found\n/, "an unset env is not printed");
  assert.match(msg, /RCA: given\n/);
  assert.match(msg, /RCA: not given\n/);
});

test("long RCA text is flattened and capped; unknown RCA is skipped", () => {
  const long = "word ".repeat(300);
  const msg = buildIssuesMessage({ title: "T", issues: [issue()], rca: { "CAV-1": { given: true, text: `${long}\n\n  end` } }, today: TODAY });
  const line = msg.split("\n").find((l) => l.startsWith("   RCA: "))!;
  assert.ok(line.length <= "   RCA: ".length + RCA_EXCERPT_MAX + 1, "capped at the limit plus the ellipsis");
  assert.ok(line.length > "   RCA: ".length + RCA_EXCERPT_MAX - 10, "but still close to the cap, not cut short");
  assert.ok(line.endsWith("…"));
  assert.ok(!line.includes("end"), "text past the cap is dropped");

  const none = buildIssuesMessage({ title: "T", issues: [issue()], rca: {}, today: TODAY });
  assert.ok(!none.includes("RCA"));
});

test("all-time range, truncation note and empty list", () => {
  const msg = buildIssuesMessage({ title: "T", from: "2000-01-01", to: "2026-10-06", issues: [issue()], rca: {}, truncated: true, today: TODAY });
  assert.match(msg, /Raised: all time/);
  assert.match(msg, /\(first 1 shown — narrow the date range for the rest\)/);
  assert.match(buildIssuesMessage({ title: "T", issues: [], rca: {}, today: TODAY }), /0 issues/);
});
