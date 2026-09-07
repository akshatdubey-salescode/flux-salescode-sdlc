import test from "node:test";
import assert from "node:assert/strict";
import { classifySprintItemRisk, summarizeRisk, istNowStr, RISK_LABELS } from "./risk";

const NOW = "2026-09-07T12:00:00";

function item(over: Partial<Parameters<typeof classifySprintItemRisk>[0]> = {}) {
  return { statusCategory: "In Progress", startDate: "2026-09-01", dueDate: "2026-09-30", ...over };
}

test("done items never carry risk, whatever their dates", () => {
  assert.equal(classifySprintItemRisk(item({ statusCategory: "Done", dueDate: "2020-01-01" }), NOW), null);
  assert.equal(classifySprintItemRisk(item({ statusCategory: "Complete", dueDate: "2020-01-01" }), NOW), null);
});

test("a past due date is overdue", () => {
  assert.equal(classifySprintItemRisk(item({ dueDate: "2026-09-06" }), NOW), "overdue");
});

test("a comfortable window is not flagged", () => {
  assert.equal(classifySprintItemRisk(item({ startDate: "2026-09-01", dueDate: "2026-12-31" }), NOW), null);
});

test("missing either planned date is unplanned, not on track", () => {
  assert.equal(classifySprintItemRisk(item({ startDate: null }), NOW), "unplanned");
  assert.equal(classifySprintItemRisk(item({ dueDate: null }), NOW), "unplanned");
  assert.equal(classifySprintItemRisk(item({ startDate: null, dueDate: null }), NOW), "unplanned");
});

test("summarizeRisk counts each bucket and totals the attention figure", () => {
  const counts = summarizeRisk(
    [
      item({ dueDate: "2026-09-01" }),
      item({ dueDate: "2026-09-02" }),
      item({ startDate: null }),
      item({ statusCategory: "Done", dueDate: "2020-01-01" }),
      item({ dueDate: "2026-12-31" }),
    ],
    NOW
  );
  assert.equal(counts.overdue, 2);
  assert.equal(counts.unplanned, 1);
  assert.equal(counts.attention, counts.overdue + counts.at_risk);
});

test("labels are the display strings the report and emails render", () => {
  assert.deepEqual(RISK_LABELS, { overdue: "Overdue", at_risk: "At risk", unplanned: "Unplanned" });
});

// The bug istNowStr exists to prevent: a UTC "today" reports yesterday for the
// first 5.5 hours of every Indian day, so work due yesterday reads as on time.
test("istNowStr resolves the IST calendar day, not the UTC one", () => {
  const justAfterIstMidnight = new Date("2026-09-07T18:31:00Z");
  assert.equal(istNowStr(justAfterIstMidnight).slice(0, 10), "2026-09-08");
  assert.equal(justAfterIstMidnight.toISOString().slice(0, 10), "2026-09-07");
});

test("istNowStr emits the shape classifyIssue parses, with a 00 midnight hour", () => {
  const s = istNowStr(new Date("2026-09-07T18:31:00Z"));
  assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  assert.equal(s, "2026-09-08T00:01:00");
});

test("an item due 'yesterday' in IST is overdue at 00:30 IST", () => {
  const nowStr = istNowStr(new Date("2026-09-07T19:00:00Z")); // 00:30 IST on the 8th
  assert.equal(classifySprintItemRisk(item({ dueDate: "2026-09-07" }), nowStr), "overdue");
});
