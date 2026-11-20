// Pure aggregation of support tickets into the client-facing report data.
// No I/O, no clock reads: every input arrives through `args`.

import {
  PRIORITIES,
  type Cell,
  type OfficeHours,
  type Priority,
  type ReportTicketInput,
  type SlaTargets,
  type SupportCategory,
  type SummaryRowKey,
  type SupportReportData,
} from "./types";
import { ageDays, salescodeMinutes } from "./time";
import { istDateOf } from "./windows";

const SUMMARY_ROWS: SummaryRowKey[] = [
  "bugs",
  "rca",
  "understanding",
  "data_issue",
  "data_upload",
  "image_upload",
  "others",
  "total",
];

const CATEGORY_ROW: Record<SupportCategory, SummaryRowKey> = {
  bug: "bugs",
  understanding: "understanding",
  data_issue: "data_issue",
  data_upload: "data_upload",
  image_upload: "image_upload",
  others: "others",
};

const PRIORITY_RANK: Record<Priority, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

type Categorised = ReportTicketInput & { category: SupportCategory };

function emptySummary(): SupportReportData["summary"] {
  const summary = {} as SupportReportData["summary"];
  for (const row of SUMMARY_ROWS) {
    const cells = {} as Record<"all" | Priority, Cell>;
    for (const k of ["all", ...PRIORITIES] as const) cells[k] = { ftd: 0, period: 0, open: 0 };
    summary[row] = cells;
  }
  return summary;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

export function buildReportData(args: {
  projectName: string;
  reportDate: string;
  sharedBy: string;
  window: { start: string; end: string; label: string };
  sla: SlaTargets;
  officeHours: OfficeHours;
  tickets: ReportTicketInput[];
  now: Date;
}): SupportReportData {
  const { reportDate, window, officeHours } = args;

  const isFtd = (t: ReportTicketInput) => istDateOf(t.createdAt) === reportDate;
  const inPeriod = (t: ReportTicketInput) => {
    const d = istDateOf(t.createdAt);
    return d >= window.start && d <= window.end;
  };
  // Open = still open AND created in the report period: an MTD report's
  // "Open" is this month's tickets that are still open, not every open
  // ticket ever (user decision, 2026-11-20).
  const isOpen = (t: ReportTicketInput) => t.resolvedAt === null && inPeriod(t);

  const uncategorised: SupportReportData["uncategorised"] = [];
  const counted: Categorised[] = [];
  for (const t of args.tickets) {
    if (t.category === null) {
      if (isFtd(t) || inPeriod(t)) {
        uncategorised.push({ issueId: t.issueId, jiraKey: t.jiraKey, summary: t.summary });
      }
    } else {
      counted.push(t as Categorised);
    }
  }

  // §1 summary
  const summary = emptySummary();
  for (const t of counted) {
    // A null priority upstream is bucketed to P4 so the "all" column reconciles.
    const p: Priority = t.priority ?? "P4";
    const ftd = isFtd(t) ? 1 : 0;
    const period = inPeriod(t) ? 1 : 0;
    const open = isOpen(t) ? 1 : 0;
    if (ftd + period + open === 0) continue;

    const rows: SummaryRowKey[] = [CATEGORY_ROW[t.category], "total"];
    if (t.category === "bug" && t.rcaGiven) rows.push("rca");
    for (const row of rows) {
      for (const k of [p, "all"] as const) {
        const cell = summary[row][k];
        cell.ftd += ftd;
        cell.period += period;
        cell.open += open;
      }
    }
  }

  // §2 SLA, over categorised tickets created in the period
  const periodTickets = counted.filter(inPeriod);
  const sla = {} as SupportReportData["sla"];
  for (const p of PRIORITIES) {
    const ofP = periodTickets.filter((t) => (t.priority ?? "P4") === p);
    const responses = ofP
      .filter((t) => t.firstRespondedAt !== null)
      .map((t) => salescodeMinutes(t.createdAt, t.firstRespondedAt!, t.events, officeHours));
    const resolutions = ofP
      .filter((t) => t.resolvedAt !== null)
      .map((t) => salescodeMinutes(t.createdAt, t.resolvedAt!, t.events, officeHours));
    sla[p] = {
      agreed: { responseMin: args.sla[p].responseMin, resolutionMin: args.sla[p].resolutionMin },
      avgResponseMin: mean(responses),
      avgResolutionMin: mean(resolutions),
    };
  }

  // §3 P1/P2 impact
  const impact: SupportReportData["impact"] = periodTickets
    .filter((t) => t.priority === "P1" || t.priority === "P2")
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    )
    .map((t) => ({
      jiraKey: t.jiraKey,
      summary: t.summary,
      priority: t.priority as "P1" | "P2",
      usersReported: t.usersReported,
      usersImpacted: t.usersImpacted,
      rcaShared: t.rcaGiven,
    }));

  // §4 open bugs
  const openBugs: SupportReportData["openBugs"] = counted
    .filter((t) => t.category === "bug" && isOpen(t))
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.priority ?? "P4"] - PRIORITY_RANK[b.priority ?? "P4"] ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    )
    .map((t) => {
      const createdOn = istDateOf(t.createdAt);
      return {
        jiraKey: t.jiraKey,
        summary: t.summary,
        createdOn,
        ageDays: ageDays(createdOn, reportDate),
        priority: t.priority ?? "P4",
        eta: t.eta,
      };
    });

  return {
    projectName: args.projectName,
    reportDate,
    periodLabel: window.label,
    sharedBy: args.sharedBy,
    summary,
    sla,
    impact,
    openBugs,
    uncategorised,
  };
}
