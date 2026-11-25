import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OFFICE_HOURS,
  DEFAULT_SLA,
  PRIORITIES,
  type OfficeHours,
  type ReportTicketInput,
  type SummaryRowKey,
} from "./types";
import { buildReportData } from "./aggregate";
import { toSupportTicketRow, type RawSupportTicket } from "./ticket-row";

const ist = (s: string) => new Date(s + "+05:30");
const ALL: OfficeHours = { start: "00:00", end: "24:00", days: [0, 1, 2, 3, 4, 5, 6], timeZone: "Asia/Kolkata" };
const MTD = { start: "2026-11-01", end: "2026-11-20", label: "MTD" };
const ROWS: SummaryRowKey[] = [
  "bugs",
  "rca",
  "understanding",
  "data_issue",
  "data_upload",
  "image_upload",
  "others",
  "total",
];

let seq = 0;
function mk(p: Partial<ReportTicketInput> = {}): ReportTicketInput {
  seq++;
  return {
    issueId: `i${seq}`,
    jiraKey: `RL-${seq}`,
    summary: `Ticket ${seq}`,
    priority: "P4",
    category: "bug",
    createdAt: new Date("2026-11-20T05:00:00Z"),
    resolvedAt: null,
    firstRespondedAt: null,
    rcaGiven: false,
    usersReported: null,
    usersImpacted: null,
    eta: null,
    events: [],
    ...p,
  };
}

function run(
  tickets: ReportTicketInput[],
  opts: { reportDate?: string; window?: typeof MTD; officeHours?: OfficeHours } = {},
) {
  return buildReportData({
    projectName: "Coke",
    reportDate: opts.reportDate ?? "2026-11-20",
    sharedBy: "L2 Support",
    window: opts.window ?? MTD,
    sla: DEFAULT_SLA,
    officeHours: opts.officeHours ?? ALL,
    tickets,
    now: new Date("2026-11-20T11:30:00Z"),
  });
}

test("counts FTD, period and open per priority", () => {
  const d = run([
    mk({ priority: "P3" }),
    mk({
      priority: "P3",
      createdAt: ist("2026-11-05T12:00"),
      resolvedAt: ist("2026-11-06T12:00"),
    }),
    mk({ priority: "P4", category: "data_issue", createdAt: ist("2026-10-20T12:00") }),
  ]);
  assert.deepEqual(d.summary.bugs.P3, { ftd: 1, period: 2, open: 1 });
  // created last month and still open: outside the period, so not counted at all
  assert.deepEqual(d.summary.data_issue.P4, { ftd: 0, period: 0, open: 0 });
  assert.deepEqual(d.summary.total.all, { ftd: 1, period: 2, open: 1 });
  assert.equal(d.projectName, "Coke");
  assert.equal(d.periodLabel, "MTD");
  assert.equal(d.sharedBy, "L2 Support");
});

test("FTD uses the IST day boundary", () => {
  // 2026-11-19T19:00Z is IST 2026-11-20 00:30
  const d = run([mk({ createdAt: new Date("2026-11-19T19:00:00Z") })]);
  assert.equal(d.summary.bugs.all.ftd, 1);
  // 2026-11-19T18:00Z is IST 2026-11-19 23:30
  const d2 = run([mk({ createdAt: new Date("2026-11-19T18:00:00Z") })]);
  assert.equal(d2.summary.bugs.all.ftd, 0);
  assert.equal(d2.summary.bugs.all.period, 1);
});

test("rca is a subset not added to total", () => {
  const d = run([mk({ rcaGiven: true }), mk()]);
  assert.equal(d.summary.rca.all.period, 1);
  assert.equal(d.summary.bugs.all.period, 2);
  assert.equal(d.summary.total.all.period, 2);
});

test("rcaGiven on a non-bug does not count as rca", () => {
  const d = run([mk({ category: "understanding", rcaGiven: true })]);
  assert.equal(d.summary.rca.all.period, 0);
});

test("uncategorised excluded and listed", () => {
  const t = mk({ category: null });
  const d = run([t, mk({ category: null, createdAt: ist("2026-10-01T12:00"), resolvedAt: ist("2026-10-02T12:00") })]);
  assert.equal(d.summary.total.all.ftd, 0);
  assert.equal(d.summary.total.all.open, 0);
  assert.equal(d.uncategorised.length, 1);
  assert.deepEqual(d.uncategorised[0], { issueId: t.issueId, jiraKey: t.jiraKey, summary: t.summary });
});

test("summary has every row with all + P1..P4 cells", () => {
  const d = run([]);
  assert.deepEqual(Object.keys(d.summary).sort(), [...ROWS].sort());
  for (const r of ROWS) {
    assert.deepEqual(Object.keys(d.summary[r]).sort(), ["P1", "P2", "P3", "P4", "all"]);
    for (const k of ["all", ...PRIORITIES] as const) {
      assert.deepEqual(d.summary[r][k], { ftd: 0, period: 0, open: 0 });
    }
  }
});

test("all equals sum of priorities", () => {
  const d = run([
    mk({ priority: "P1" }),
    mk({ priority: "P2", category: "understanding" }),
    mk({ priority: "P3", category: "data_issue", resolvedAt: ist("2026-11-20T15:00") }),
    mk({ priority: "P4", category: "data_upload", createdAt: ist("2026-11-03T11:00") }),
    mk({ priority: "P1", category: "image_upload", createdAt: ist("2026-10-03T11:00") }),
    mk({ priority: "P2", category: "others", rcaGiven: true }),
    mk({ priority: "P3", rcaGiven: true, createdAt: ist("2026-11-10T11:00") }),
    mk({ priority: "P2", resolvedAt: ist("2026-11-20T16:00") }),
  ]);
  for (const r of ROWS) {
    for (const col of ["ftd", "period", "open"] as const) {
      const sum = PRIORITIES.reduce((s, p) => s + d.summary[r][p][col], 0);
      assert.equal(d.summary[r].all[col], sum, `${r}.${col}`);
    }
  }
  // total = sum of the six category rows
  const cats: SummaryRowKey[] = ["bugs", "understanding", "data_issue", "data_upload", "image_upload", "others"];
  for (const col of ["ftd", "period", "open"] as const) {
    for (const k of ["all", ...PRIORITIES] as const) {
      const sum = cats.reduce((s, r) => s + d.summary[r][k][col], 0);
      assert.equal(d.summary.total[k][col], sum, `total.${k}.${col}`);
    }
  }
  assert.deepEqual(d.summary.total.all, { ftd: 5, period: 7, open: 5 });
});

test("open counts only open tickets created in the period", () => {
  const d = run([
    mk({ priority: "P3", createdAt: ist("2026-07-20T12:00") }), // old, open: excluded
    mk({ priority: "P3", createdAt: ist("2026-11-02T12:00") }), // this month, open
    mk({ priority: "P3", createdAt: ist("2026-11-03T12:00"), resolvedAt: ist("2026-11-04T12:00") }),
  ]);
  assert.deepEqual(d.summary.bugs.P3, { ftd: 0, period: 2, open: 1 });
  assert.deepEqual(d.summary.total.all, { ftd: 0, period: 2, open: 1 });
  assert.equal(d.openBugs.length, 1);
});

test("old open uncategorised tickets are not listed", () => {
  const d = run([mk({ category: null, createdAt: ist("2026-07-20T12:00") })]);
  assert.equal(d.uncategorised.length, 0);
});

test("sla averages exclude client time", () => {
  const T = ist("2026-11-10T00:00");
  const h = (n: number) => new Date(T.getTime() + n * 3600_000);
  const d = run([
    mk({
      priority: "P3",
      createdAt: T,
      resolvedAt: h(24),
      firstRespondedAt: new Date(T.getTime() + 5 * 60_000),
      events: [
        { side: "client", at: h(2) },
        { side: "salescode", at: h(14) },
      ],
    }),
  ]);
  assert.equal(d.sla.P3.avgResolutionMin, 720);
  assert.equal(d.sla.P3.avgResponseMin, 5);
  assert.equal(d.sla.P1.avgResponseMin, null);
  assert.equal(d.sla.P1.avgResolutionMin, null);
  assert.deepEqual(d.sla.P3.agreed, DEFAULT_SLA.P3);
});

test("sla averages respect office hours", () => {
  const d = run(
    [
      mk({
        priority: "P4",
        createdAt: ist("2026-11-06T18:30"),
        resolvedAt: ist("2026-11-09T10:30"),
      }),
    ],
    { officeHours: DEFAULT_OFFICE_HOURS },
  );
  assert.equal(d.sla.P4.avgResolutionMin, 60);
  assert.equal(d.sla.P4.avgResponseMin, null);
});

test("sla averages are rounded means over period tickets only", () => {
  const T = ist("2026-11-10T00:00");
  const m = (n: number) => new Date(T.getTime() + n * 60_000);
  const d = run([
    mk({ priority: "P2", createdAt: T, firstRespondedAt: m(1) }),
    mk({ priority: "P2", createdAt: T, firstRespondedAt: m(2) }),
    // outside the period: ignored
    mk({ priority: "P2", createdAt: ist("2026-10-10T00:00"), firstRespondedAt: ist("2026-10-10T05:00") }),
  ]);
  assert.equal(d.sla.P2.avgResponseMin, 2); // Math.round(1.5)
  assert.equal(d.sla.P2.avgResolutionMin, null);
});

test("impact lists P1/P2 in period only", () => {
  const a = mk({ priority: "P2", createdAt: ist("2026-11-02T11:00"), usersReported: 3, usersImpacted: 40 });
  const b = mk({ priority: "P1", createdAt: ist("2026-11-15T11:00") });
  const c = mk({ priority: "P1", createdAt: ist("2026-11-05T11:00") });
  const d = run([
    a,
    b,
    c,
    mk({ priority: "P3" }),
    mk({ priority: "P1", createdAt: ist("2026-10-30T11:00") }),
    mk({ priority: "P1", category: null }),
  ]);
  assert.deepEqual(
    d.impact.map((i) => i.jiraKey),
    [c.jiraKey, b.jiraKey, a.jiraKey],
  );
  assert.deepEqual(d.impact[2], {
    jiraKey: a.jiraKey,
    summary: a.summary,
    priority: "P2",
    usersReported: 3,
    usersImpacted: 40,
    rcaShared: false,
  });
});

test("impact entries carry the RCA shared toggle", () => {
  const shared = mk({ priority: "P1", createdAt: ist("2026-11-03T11:00"), rcaGiven: true });
  const not = mk({ priority: "P2", createdAt: ist("2026-11-04T11:00") });
  const d = run([shared, not]);
  assert.deepEqual(
    d.impact.map((i) => [i.jiraKey, i.rcaShared]),
    [
      [shared.jiraKey, true],
      [not.jiraKey, false],
    ],
  );
});

// Raised time (user decision, 2026-11-20): the row mapper feeds the effective
// raised time into createdAt, so every bucket follows it.
function mapped(over: Partial<RawSupportTicket>) {
  return toSupportTicketRow({
    issueId: "raw-1",
    jiraKey: "RL-900",
    summary: "Raised before Jira",
    status: "Open",
    statusCategory: "To Do",
    canonicalStatus: null,
    issueType: "Bug",
    priority: "High",
    customFields: {},
    jiraCreatedAt: ist("2026-11-15T12:00"),
    jiraUpdatedAt: null,
    completedAt: null,
    endDateFieldIds: null,
    storedCategory: null,
    ownerSide: null,
    raisedAt: null,
    closedAt: null,
    rcaShared: null,
    firstRespondedAt: null,
    usersReported: null,
    usersImpacted: null,
    fluxEta: null,
    events: null,
    ...over,
  });
}

test("raised in October, created in Jira in November: counts in October, not the Nov MTD", () => {
  const t = mapped({ raisedAt: ist("2026-10-28T12:00"), jiraCreatedAt: ist("2026-11-02T12:00") });
  const nov = run([t]);
  assert.equal(nov.summary.bugs.all.period, 0);
  assert.equal(nov.summary.bugs.all.open, 0);
  assert.equal(nov.openBugs.length, 0);

  const oct = run([t], {
    reportDate: "2026-10-31",
    window: { start: "2026-10-01", end: "2026-10-31", label: "MTD" },
  });
  assert.equal(oct.summary.bugs.all.period, 1);
  assert.equal(oct.summary.bugs.all.open, 1);
  assert.deepEqual(
    oct.openBugs.map((b) => [b.jiraKey, b.createdOn, b.ageDays]),
    [["RL-900", "2026-10-28", 3]],
  );
});

test("open bug detail: Reported On and Age use the raised time, not Jira creation", () => {
  const raised = mapped({ raisedAt: ist("2026-11-03T09:00") }); // Jira: 15 Nov
  const plain = mapped({ issueId: "raw-2", jiraKey: "RL-901" }); // no raised time
  const d = run([raised, plain]);
  assert.deepEqual(
    d.openBugs.map((b) => [b.jiraKey, b.createdOn, b.ageDays]),
    [
      ["RL-900", "2026-11-03", 17],
      ["RL-901", "2026-11-15", 5],
    ],
  );
});

test("raised time starts the SLA response clock", () => {
  const t = mapped({
    raisedAt: ist("2026-11-15T11:00"),
    firstRespondedAt: ist("2026-11-15T12:30"), // 30 min after Jira creation, 90 after raised
  });
  assert.equal(run([t]).sla.P2.avgResponseMin, 90);
});

test("openBugs sorted by priority then age, with ageDays", () => {
  const old4 = mk({ priority: "P4", createdAt: ist("2026-11-01T12:00"), eta: "2026-11-30" });
  const new4 = mk({ priority: "P4" });
  const p2 = mk({ priority: "P2", createdAt: ist("2026-11-18T12:00") });
  const d = run([
    new4,
    old4,
    p2,
    mk({ priority: "P1", resolvedAt: ist("2026-11-20T12:00") }),
    mk({ priority: "P1", category: "data_issue" }),
    mk({ priority: "P1", createdAt: ist("2026-10-01T12:00") }), // before the period
  ]);
  assert.deepEqual(
    d.openBugs.map((b) => b.jiraKey),
    [p2.jiraKey, old4.jiraKey, new4.jiraKey],
  );
  assert.deepEqual(d.openBugs[1], {
    jiraKey: old4.jiraKey,
    summary: old4.summary,
    createdOn: "2026-11-01",
    ageDays: 19,
    priority: "P4",
    eta: "2026-11-30",
  });
  assert.equal(d.openBugs[0].ageDays, 2);
  assert.equal(d.openBugs[2].ageDays, 0);
});

test("1st-of-month report: ftd equals period", () => {
  const d = run(
    [
      mk({ createdAt: ist("2026-11-01T12:00") }),
      mk({ priority: "P2", category: "others", createdAt: ist("2026-11-01T01:00") }),
      mk({ createdAt: ist("2026-10-31T23:00") }),
    ],
    { reportDate: "2026-11-01", window: { start: "2026-11-01", end: "2026-11-01", label: "MTD" } },
  );
  for (const r of ROWS) {
    for (const k of ["all", ...PRIORITIES] as const) {
      assert.equal(d.summary[r][k].ftd, d.summary[r][k].period, `${r}.${k}`);
    }
  }
  assert.equal(d.summary.total.all.ftd, 2);
});

test("FTD and period days are the project's calendar days, not IST's", () => {
  // 20 Nov 2026 22:00 in Buenos Aires = 21 Nov 06:30 IST: FTD for a Buenos Aires report dated 20 Nov.
  const t = mk({ createdAt: new Date("2026-11-21T01:00:00Z") });
  const ba = run([t], { reportDate: "2026-11-20", officeHours: { ...ALL, timeZone: "America/Argentina/Buenos_Aires" } });
  assert.equal(ba.summary.total.all.ftd, 1);
  assert.equal(ba.timeZone, "America/Argentina/Buenos_Aires");
  const ist = run([t], { reportDate: "2026-11-20" });
  assert.equal(ist.summary.total.all.ftd, 0);
});
