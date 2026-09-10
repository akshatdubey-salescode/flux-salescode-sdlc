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
    carriedToSprintId: null,
    carriedToSprintName: null,
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
      carriedOver: items.filter((i) => i.carriedFromSprintId).length,
      carriedOut: [...items, ...((over.removedItems ?? []) as SprintItemRow[])].filter(
        (i) => i.carriedToSprintId
      ).length,
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
  assert.match(html, /2 overdue<\/span>/);
});

test("the breakdown runs in sprint order, however the risk falls", () => {
  // The trouble is in the LAST sprint and the caller passed them newest-first
  // (the order the sprint reads return) — neither may reshuffle the table.
  const first = mkSprint([healthyItem], {
    id: "s1",
    name: "Demo 1",
    startDate: "2026-08-04",
    endDate: "2026-08-23",
  });
  const second = mkSprint([healthyItem], {
    id: "s2",
    name: "Demo 2",
    startDate: "2026-08-24",
    endDate: "2026-09-09",
  });
  const third = mkSprint([overdueItem, overdueItem], {
    id: "s3",
    name: "Demo 3",
    startDate: "2026-09-11",
    endDate: "2026-09-29",
  });
  const { html } = buildWorkstreamEmail(
    "Coke Ph",
    null,
    [third, second, first],
    "",
    "Lead",
    "https://flux.example/workstreams/w1",
    "https://flux.example",
    NOW
  );
  // Scoped to the breakdown: the risk banner above it names Demo 3 first by
  // design, and that is not what this test is about.
  assert.match(html, /Sprints, in order/);
  const table = html.slice(html.indexOf("Sprints, in order"));
  assert.ok(table.indexOf("Demo 1") < table.indexOf("Demo 2"), "Demo 1 should precede Demo 2");
  assert.ok(table.indexOf("Demo 2") < table.indexOf("Demo 3"), "Demo 2 should precede Demo 3");
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

// --- Carryover -------------------------------------------------------------
// The gap these cover: a carryover COPIES the issue into the next sprint and
// leaves the row in the old one untouched, so before this the closed sprint's
// mail showed two unfinished items and no hint that anyone had picked them up.

const carriedOutItem = mkItem({
  id: "e",
  jiraKey: "ECU-500",
  dueDate: "2026-12-31",
  carriedToSprintId: "s2",
  carriedToSprintName: "Demo 3",
});

test("a sprint that handed work on names the destination, per item and in a summary line", () => {
  const { html } = sprintEmail([carriedOutItem, healthyItem]);
  assert.match(html, /Carried to Demo 3/, "per-item destination badge missing");
  assert.match(html, /1 item carried forward to Demo 3/, "spillover banner missing");
  assert.match(html, /<strong>ECU-500<\/strong> was not finished in this sprint and continues in Demo 3/);
  assert.match(html, /Carried forward<\/div>/, "carried-forward tile missing");
});

test("the spillover line groups by destination and pluralises per group", () => {
  const { html } = sprintEmail([
    carriedOutItem,
    mkItem({ id: "f", jiraKey: "ECU-600", carriedToSprintId: "s2", carriedToSprintName: "Demo 3" }),
    mkItem({ id: "g", jiraKey: "ECU-700", carriedToSprintId: "s3", carriedToSprintName: "Demo 4" }),
  ]);
  assert.match(html, /3 items carried forward to later sprints/);
  assert.match(html, /<strong>ECU-500, ECU-600<\/strong> were not finished in this sprint and continue in Demo 3/);
  assert.match(html, /<strong>ECU-700<\/strong> was not finished in this sprint and continues in Demo 4/);
});

test("a sprint that carried nothing forward says nothing about it", () => {
  const { html } = sprintEmail([healthyItem]);
  assert.ok(!html.includes("Carried forward"), "spillover chrome leaked into a sprint with no spillover");
  assert.ok(!html.includes("Carried to"), "destination badge leaked into a sprint with no spillover");
});

const carriedInItem = mkItem({
  id: "h",
  jiraKey: "ECU-800",
  dueDate: "2026-12-31",
  carriedFromSprintId: "s0",
  carriedFromSprintName: "Demo 2",
});

test("inherited work is marked too, so both ends of a spillover are readable", () => {
  const { html } = sprintEmail([carriedInItem]);
  assert.match(html, /Carried from Demo 2/);
  assert.match(html, /1 item carried in from Demo 2/, "inbound banner missing");
  assert.match(html, /<strong>ECU-800<\/strong> arrived unfinished from Demo 2 — inherited work, not new scope\./);
  assert.match(html, /Carried in<\/div>/, "carried-in tile missing");
  // Not "Carried to" — the tag legend at the foot names both directions once
  // the mail carries either tag. What must be absent is the outbound story.
  assert.ok(!html.includes("carried forward to"), "outbound banner on a sprint that handed nothing on");
  assert.ok(!html.includes("Carried forward</div>"), "outbound tile on a sprint that handed nothing on");
});

test("a sprint still in planning is where inherited work waits — it says so", () => {
  // The regression this locks down: the receiving sprint is normally PLANNED
  // when the spillover lands, and every "is it committed?" branch used to
  // swallow the origin at exactly that phase.
  const { html } = buildSprintEmail(
    mkSprint([carriedInItem], { startedAt: null, name: "Demo 3" }),
    "",
    "Lead",
    "https://flux.example/sprints/s1",
    NOW
  );
  assert.match(html, /Carried from Demo 2/, "origin badge vanished on a planned sprint");
  assert.match(html, /1 item carried in from Demo 2/, "inbound banner vanished on a planned sprint");
  assert.match(html, /Carried in<\/div>/, "carried-in tile missing on a planned sprint");
});

test("dropped inherited work is not claimed as this sprint's inheritance", () => {
  const { html } = buildSprintEmail(
    mkSprint([healthyItem], {
      removedItems: [mkItem({ id: "k", jiraKey: "ECU-810", carriedFromSprintId: "s0", carriedFromSprintName: "Demo 2" })],
    }),
    "",
    "Lead",
    "https://flux.example/sprints/s1",
    NOW
  );
  assert.ok(!html.includes("carried in from"), "a removed inherited item should not count as carried in");
});

test("the preheader counts the spillover, so the inbox line says work moved", () => {
  const { html } = sprintEmail([carriedOutItem]);
  assert.match(html, /display:none;max-height:0[^<]*<?[^>]*>?[^<]*1 carried forward/);
});

test("sprint names in carryover markers are escaped, not injected", () => {
  const { html } = sprintEmail([
    mkItem({ id: "i", jiraKey: "ECU-900", carriedToSprintId: "s9", carriedToSprintName: "<b>Demo 3</b>" }),
  ]);
  assert.ok(!html.includes("<b>Demo 3</b>"), "raw markup from a sprint name leaked into the email");
  assert.match(html, /&lt;b&gt;Demo 3&lt;\/b&gt;/);
});

test("an item moved out mid-sprint is still accounted for, though the table has dropped it", () => {
  const moved = mkItem({
    id: "j",
    jiraKey: "ECU-950",
    removedAt: "2026-09-05T00:00:00.000Z",
    removedComment: "Moved to Demo 3: needs the admin portal first",
    carriedToSprintId: "s2",
    carriedToSprintName: "Demo 3",
  });
  const { html } = buildSprintEmail(
    mkSprint([healthyItem], { removedItems: [moved] }),
    "",
    "Lead",
    "https://flux.example/sprints/s1",
    NOW
  );
  assert.ok(!html.includes("ECU-950</a>"), "a removed item should not be in the items table");
  assert.match(html, /<strong>ECU-950<\/strong> was not finished in this sprint and continues in Demo 3/);
  assert.match(html, /Carried forward<\/div>/);
});
