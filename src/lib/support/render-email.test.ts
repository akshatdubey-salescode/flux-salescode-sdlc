import test from "node:test";
import assert from "node:assert/strict";
import { PRIORITIES, type Cell, type SummaryRowKey, type SupportReportData } from "./types";
import { approverNoticeEmail, renderSupportReportEmail } from "./render-email";

const ROWS: SummaryRowKey[] = ["bugs", "rca", "understanding", "data_issue", "data_upload", "image_upload", "others", "total"];

function fixture(over: Partial<SupportReportData> = {}): SupportReportData {
  const cell = (n: number): Cell => ({ ftd: n, period: n, open: n });
  const summary = Object.fromEntries(
    ROWS.map((r) => [r, Object.fromEntries(["all", ...PRIORITIES].map((c) => [c, cell(0)]))]),
  ) as SupportReportData["summary"];
  const sla = Object.fromEntries(
    PRIORITIES.map((p) => [p, { agreed: { responseMin: 10, resolutionMin: 240 }, avgResponseMin: null, avgResolutionMin: 818 }]),
  ) as SupportReportData["sla"];
  return {
    projectName: "Acme",
    reportDate: "2026-11-20",
    periodLabel: "MTD",
    sharedBy: "L2 Support",
    summary,
    sla,
    impact: [],
    openBugs: [],
    uncategorised: [],
    ...over,
  };
}

test("subject and key copy", () => {
  const { subject, html } = renderSupportReportEmail(fixture());
  assert.equal(subject, "Issue Report — Daily Update | Acme | 20 Nov 2026");
  assert.ok(html.includes("SLA REPORT — MTD"));
  assert.ok(html.includes("P1 &amp; P2 TICKET IMPACT REPORT — MTD"));
  assert.ok(html.includes("Shared by: L2 Support"));
  assert.ok(html.includes("Date: 20 Nov 2026"));
  assert.ok(html.includes("Confidential"));
  assert.ok(!html.includes("Internal Use Only"));
  assert.ok(html.includes("Response: 10 min<br>Resolution: 4 hr"));
  assert.ok(html.includes("13 hr 38 min"));
  assert.ok(html.includes("No open bugs."));
});

test("escapes Jira strings", () => {
  const { html } = renderSupportReportEmail(
    fixture({ impact: [{ jiraKey: "A-1", summary: "<b>x</b>", priority: "P1", usersReported: null, usersImpacted: 3, rcaShared: false }] }),
  );
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
  assert.ok(!html.includes("<b>x</b>"));
});

test("empty impact state", () => {
  assert.ok(renderSupportReportEmail(fixture()).html.includes("No P1 / P2 tickets reported."));
});

test("P3 has exactly 2 sub-headers", () => {
  const { html } = renderSupportReportEmail(fixture());
  assert.equal(html.split('data-col="P3"').length - 1, 2);
  assert.equal(html.split('data-col="P1"').length - 1, 3);
});

test("open bugs rows", () => {
  const { html } = renderSupportReportEmail(
    fixture({
      openBugs: [
        { jiraKey: "A-2", summary: "Boom", createdOn: "2026-11-16", ageDays: 4, priority: "P2", eta: "2026-11-25" },
        { jiraKey: "A-3", summary: "Bam", createdOn: "2026-11-01", ageDays: 19, priority: "P4", eta: null },
      ],
    }),
  );
  assert.ok(html.includes("4 d"));
  assert.ok(html.includes("25 Nov 2026"));
  assert.ok(html.includes("16 Nov 2026"));
  assert.ok(!html.includes("No open bugs."));
});

test("approver notice", () => {
  const a = approverNoticeEmail({ projectName: "Acme", reportDate: "2026-11-20", reviewUrl: "https://x/y?a=1&b=2", uncategorisedCount: 3 });
  assert.equal(a.subject, "Support report ready for approval — Acme — 20 Nov 2026");
  assert.ok(a.html.includes("3"));
  assert.ok(a.html.includes("blocked"));
  assert.ok(a.html.includes("https://x/y?a=1&amp;b=2"));
  const b = approverNoticeEmail({ projectName: "Acme", reportDate: "2026-11-20", reviewUrl: "https://x", uncategorisedCount: 0 });
  assert.ok(!b.html.includes("blocked"));
});

test("SLA table is metrics x priorities", () => {
  const { html } = renderSupportReportEmail(fixture());
  const sec = html.slice(html.indexOf("SLA REPORT — MTD"), html.indexOf("P1 &amp; P2 TICKET"));
  const idx = ["Metric", ">P1<", ">P2<", ">P3<", ">P4<"].map((m) => sec.indexOf(m));
  assert.ok(idx.every((i) => i >= 0) && [...idx].sort((a, b) => a - b).join() === idx.join());
  const rows = ["Agreed SLA", "Avg Response Time", "Avg Resolution Time"].map((m) => sec.indexOf(m));
  assert.ok(rows.every((i) => i > idx[4]) && [...rows].sort((a, b) => a - b).join() === rows.join());
  assert.ok(!sec.includes("border-radius:10px"));
  assert.ok(html.includes(">Category<"));
});

test("escapes sharedBy/projectName and dashes null user counts", () => {
  const { html, subject } = renderSupportReportEmail(
    fixture({
      sharedBy: "<i>me</i>",
      projectName: "A&B",
      impact: [{ jiraKey: "A-1", summary: "s", priority: "P1", usersReported: null, usersImpacted: null, rcaShared: true }],
    }),
  );
  assert.ok(html.includes("Shared by: &lt;i&gt;me&lt;/i&gt;"));
  assert.ok(subject.includes("A&B"));
  assert.ok(html.includes("<title>Issue Report — Daily Update | A&amp;B"));
  assert.ok(html.includes("text-align:center;\">–</td>"));
});

test("summary: no ISSUES RECEIVED header, REQUESTS RECEIVED kept, row order unchanged", () => {
  const { html } = renderSupportReportEmail(fixture());
  assert.ok(!html.includes("ISSUES RECEIVED"));
  assert.ok(html.includes("REQUESTS RECEIVED"));
  const order = ["Total Bugs", "RCA Shared", "Understanding", "Data Issue", "REQUESTS RECEIVED", "Data Upload", "Image Upload", "Others", ">Total<"];
  const at = order.map((s) => html.indexOf(s));
  assert.ok(at.every((i) => i >= 0), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
});

test("impact: RCA Shared column after Users Impacted, Yes / No / – for older reports", () => {
  const { html } = renderSupportReportEmail(
    fixture({
      impact: [
        { jiraKey: "A-1", summary: "yes", priority: "P1", usersReported: 1, usersImpacted: 2, rcaShared: true },
        { jiraKey: "A-2", summary: "no", priority: "P2", usersReported: 1, usersImpacted: 2, rcaShared: false },
        // A report stored before the toggle existed has no rcaShared.
        { jiraKey: "A-3", summary: "old", priority: "P2", usersReported: 1, usersImpacted: 2 },
      ],
    }),
  );
  const section = html.slice(html.indexOf("TICKET IMPACT REPORT"), html.indexOf("OPEN BUG DETAIL"));
  assert.ok(section.indexOf(">Users Impacted<") < section.indexOf(">RCA Shared<"));
  const cells = (key: string) => {
    const row = section.slice(section.indexOf(`<b>${key}</b>`));
    return row.slice(0, row.indexOf("</tr>"));
  };
  assert.ok(cells("A-1").endsWith('text-align:center;">Yes</td>'), cells("A-1"));
  assert.ok(cells("A-2").endsWith('text-align:center;">No</td>'), cells("A-2"));
  assert.ok(cells("A-3").endsWith('text-align:center;">–</td>'), cells("A-3"));
});
