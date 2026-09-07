import test from "node:test";
import assert from "node:assert/strict";
import { buildSprintEmail, buildWorkstreamEmail } from "./email-progress";
import { RISK_EMAIL_STYLES } from "./email-html";
import type { SprintWithItems, SprintItemRow } from "./entries";

const NOW = "2026-09-07T12:00:00";

function mkItem(over: Partial<SprintItemRow> = {}): SprintItemRow {
  return {
    id: "i1",
    issueId: "1",
    jiraKey: "ECU-1",
    jiraBaseUrl: "https://example.atlassian.net",
    summary: "Some work",
    jiraStatus: "In Progress",
    statusCategory: "In Progress",
    progress: "in_progress",
    issueType: "Task",
    priority: "P2",
    assigneeEmail: "dev@example.com",
    assigneeName: "Dev One",
    addedBy: "u1",
    addedByName: "Lead",
    addedAt: "2026-09-01T00:00:00.000Z",
    startDate: "2026-09-01",
    dueDate: "2026-09-30",
    actualStart: null,
    actualEnd: null,
    committed: true,
    addedComment: null,
    carriedFromSprintId: null,
    carriedFromSprintName: null,
    removedAt: null,
    removedByName: null,
    removedComment: null,
    ...over,
  };
}

function mkSprint(items: SprintItemRow[], over: Partial<SprintWithItems> = {}): SprintWithItems {
  const done = items.filter((i) => i.progress === "done").length;
  return {
    id: "s1",
    projectId: "p1",
    boardId: null,
    workstreamId: null,
    workstreamName: null,
    name: "Sprint 12",
    goal: "Ship QPS percentage benefits",
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    createdBy: "u1",
    createdByName: "Lead",
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    startedAt: "2026-09-01T00:00:00.000Z",
    startedByName: "Lead",
    completedAt: null,
    completedByName: null,
    items,
    removedItems: [],
    notes: [],
    rollup: {
      total: items.length,
      todo: items.filter((i) => i.progress === "todo").length,
      inProgress: items.filter((i) => i.progress === "in_progress").length,
      done,
      committed: items.length,
      committedDone: done,
      addedAfterStart: 0,
      carriedOver: 0,
      removed: 0,
    },
    ...over,
  };
}

const overdueItem = mkItem({ id: "a", jiraKey: "ECU-100", dueDate: "2026-09-03" });
// 20% or less of the Sep 1 -> Sep 7 working window is left at noon on the 7th.
const atRiskItem = mkItem({ id: "b", jiraKey: "ECU-200", startDate: "2026-09-01", dueDate: "2026-09-07" });
const unplannedItem = mkItem({ id: "c", jiraKey: "ECU-300", startDate: null, dueDate: null });
const healthyItem = mkItem({ id: "d", jiraKey: "ECU-400", dueDate: "2026-12-31" });

function sprintEmail(items: SprintItemRow[]) {
  return buildSprintEmail(mkSprint(items), "", "Lead", "https://flux.example/sprints/s1", NOW);
}

test("the subject carries the risk clause so it reads in the inbox list", () => {
  const { subject } = sprintEmail([overdueItem, atRiskItem, healthyItem]);
  assert.match(subject, /1 overdue/);
  assert.match(subject, /1 at risk/);
});

test("a clean sprint gets no risk clause in the subject", () => {
  const { subject } = sprintEmail([healthyItem]);
  assert.doesNotMatch(subject, /overdue|at risk/);
});

test("overdue items paint the row and the badge in the overdue colour", () => {
  const { html } = sprintEmail([overdueItem, healthyItem]);
  assert.ok(html.includes(RISK_EMAIL_STYLES.overdue.row), "overdue row tint missing");
  assert.ok(html.includes(RISK_EMAIL_STYLES.overdue.fg), "overdue accent missing");
  assert.match(html, /Overdue<\/span>/);
});

test("at-risk items use amber, not the overdue red", () => {
  const { html } = sprintEmail([atRiskItem, healthyItem]);
  assert.ok(html.includes(RISK_EMAIL_STYLES.at_risk.row), "at-risk row tint missing");
  assert.ok(!html.includes(RISK_EMAIL_STYLES.overdue.row), "no row should be tinted red here");
});

test("colour is never the only signal — every risky row carries its text label", () => {
  const { html } = sprintEmail([overdueItem, atRiskItem, unplannedItem]);
  for (const label of ["Overdue", "At risk", "Unplanned"]) {
    assert.ok(html.includes(label), `${label} label missing`);
  }
});

test("risky items sort above healthy ones, so truncation never hides them", () => {
  const { html } = sprintEmail([healthyItem, unplannedItem, atRiskItem, overdueItem]);
  const at = (key: string) => html.indexOf(key);
  assert.ok(at("ECU-100") < at("ECU-200"), "overdue should precede at risk");
  assert.ok(at("ECU-200") < at("ECU-300"), "at risk should precede unplanned");
  assert.ok(at("ECU-300") < at("ECU-400"), "unplanned should precede healthy");
});

test("the banner names the offending issues", () => {
  const { html } = sprintEmail([overdueItem, atRiskItem]);
  assert.match(html, /need attention/);
  assert.match(html, /<strong>Overdue:<\/strong> ECU-100/);
  assert.match(html, /<strong>At risk:<\/strong> ECU-200/);
});

test("a clean sprint gets the reassuring green banner instead", () => {
  const { html } = sprintEmail([healthyItem]);
  assert.match(html, /Nothing overdue or at risk/);
  assert.ok(!html.includes(RISK_EMAIL_STYLES.overdue.row));
});

test("the mail carries inbox preview text and a colour legend", () => {
  const { html } = sprintEmail([overdueItem]);
  assert.match(html, /display:none;max-height:0/);
  assert.match(html, /due date passed/);
  assert.match(html, /under 20% of planned time left/);
});

test("item summaries are escaped, not injected", () => {
  const { html } = sprintEmail([mkItem({ summary: '<script>alert("x")</script>' })]);
  assert.ok(!html.includes("<script>"), "raw script tag leaked into the email");
  assert.match(html, /&lt;script&gt;/);
});

test("workstream mail aggregates risk across sprints and says where it sits", () => {
  const troubled = mkSprint([overdueItem, overdueItem], { id: "s1", name: "Sprint A" });
  const clean = mkSprint([healthyItem], { id: "s2", name: "Sprint B" });
  const { subject, html } = buildWorkstreamEmail(
    "QPS Engine",
    null,
    [clean, troubled],
    "",
    "Lead",
    "https://flux.example/workstreams/w1",
    "https://flux.example",
    NOW
  );
  assert.match(subject, /2 overdue/);
  assert.match(html, /<strong>Concentrated in:<\/strong> Sprint A/);
  // the troubled sprint outranks the clean one in the breakdown
  assert.ok(html.indexOf("Sprint A") < html.indexOf("Sprint B"));
  assert.match(html, /2 overdue<\/span>/);
});

test("a clean workstream reports on track per sprint", () => {
  const { html } = buildWorkstreamEmail(
    "QPS Engine",
    null,
    [mkSprint([healthyItem])],
    "",
    "Lead",
    "https://flux.example/workstreams/w1",
    "https://flux.example",
    NOW
  );
  assert.match(html, /On track/);
  assert.match(html, /Nothing overdue or at risk/);
});
