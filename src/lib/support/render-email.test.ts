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
    fixture({ impact: [{ jiraKey: "A-1", summary: "<b>x</b>", priority: "P1", usersReported: null, usersImpacted: 3 }] }),
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
