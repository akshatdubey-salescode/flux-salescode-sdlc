import { classifyIssue } from "@/lib/jira/estimate";

// ---------------------------------------------------------------------------
// The single risk classifier for sprint items.
//
// This logic used to exist twice — once in the on-screen sprint table and once
// in the Excel report — and not at all in the stakeholder emails, which meant a
// progress mail could disagree with the workbook attached to it. Everything now
// classifies here.
//
// The input is a structural type rather than SprintItemRow so this module pulls
// in no server-only code and stays safe to import from client components.
// ---------------------------------------------------------------------------

export type SprintItemRisk = "overdue" | "at_risk" | "unplanned" | null;

export type RiskInput = {
  statusCategory: string | null;
  startDate: string | null;
  dueDate: string | null;
};

export const RISK_LABELS: Record<Exclude<SprintItemRisk, null>, string> = {
  overdue: "Overdue",
  at_risk: "At risk",
  unplanned: "Unplanned",
};

/** Worst first — the ordering the sprint table sort and the emails both use. */
export const RISK_ORDER: Record<Exclude<SprintItemRisk, null>, number> = {
  overdue: 0,
  at_risk: 1,
  unplanned: 2,
};

/**
 * overdue   — the due date has already passed
 * at_risk   — 20% or less of the working hours between start and due remain
 * unplanned — no start or due date, so there is nothing to judge against
 * null      — done, or on track
 */
export function classifySprintItemRisk(item: RiskInput, nowStr: string): SprintItemRisk {
  const cat = (item.statusCategory ?? "").toLowerCase();
  if (cat === "done" || cat.includes("complete")) return null;
  if (!item.startDate || !item.dueDate) return "unplanned";
  const label = classifyIssue(item.statusCategory, item.startDate, item.dueDate, nowStr);
  return label === "overdue" || label === "at_risk" ? label : null;
}

export type RiskCounts = {
  overdue: number;
  at_risk: number;
  unplanned: number;
  /** overdue + at_risk — the "needs attention" figure the emails lead with. */
  attention: number;
};

export function summarizeRisk(items: RiskInput[], nowStr: string): RiskCounts {
  const out: RiskCounts = { overdue: 0, at_risk: 0, unplanned: 0, attention: 0 };
  for (const item of items) {
    const risk = classifySprintItemRisk(item, nowStr);
    if (risk) out[risk] += 1;
  }
  out.attention = out.overdue + out.at_risk;
  return out;
}

const IST_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/**
 * "now" as an IST wall-clock string in the shape classifyIssue expects,
 * "YYYY-MM-DDTHH:mm:ss".
 *
 * Server-side callers must not reach for toISOString() here. That is UTC, so
 * between midnight and 05:30 IST it reports yesterday's date and an item due
 * yesterday silently fails to register as overdue. The on-screen table stays
 * viewer-local; the email and the workbook it carries both anchor to IST, the
 * same zone the report already renders actual timestamps in.
 */
export function istNowStr(now: Date = new Date()): string {
  const p: Record<string, string> = {};
  for (const { type, value } of IST_PARTS.formatToParts(now)) p[type] = value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
