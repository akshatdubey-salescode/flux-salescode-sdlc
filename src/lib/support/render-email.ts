// Pure HTML string builder for the client-facing support report email.
// Table-based, inline styles only (mail clients). No server/DB/React imports.
import { format } from "date-fns";
import { CATEGORY_LABELS, PRIORITIES, type Priority, type SummaryRowKey, type SupportReportData } from "./types";
import { formatDuration } from "./time";

const TEAL_DARK = "#1f4e5f";
const TEAL_LIGHT = "#3a9a9a";
const BAR = "#4aa6a6";
const PRIORITY_COLOR: Record<Priority, string> = { P1: "#e58a7d", P2: "#e8bd7d", P3: "#9b8cc4", P4: "#7a9cc0" };
const FONT = "font-family:Arial,Helvetica,sans-serif;";
const MUTED = "#b5bcc2";
const TEXT = "#26343b";
const BORDER = "#e3e8ea";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Parse YYYY-MM-DD from parts (no host-timezone shift).
function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return format(new Date(y, m - 1, d), "d MMM yyyy");
}

const th = (content: string, extra = "", attrs = ""): string =>
  `<td ${attrs} style="${FONT}font-size:12px;font-weight:bold;color:#ffffff;padding:8px 10px;text-align:center;${extra}">${content}</td>`;
const td = (content: string, extra = ""): string =>
  `<td style="${FONT}font-size:13px;color:${TEXT};padding:8px 10px;border-bottom:1px solid ${BORDER};${extra}">${content}</td>`;

function pill(p: Priority): string {
  return `<span style="${FONT}display:inline-block;background:${PRIORITY_COLOR[p]};color:#ffffff;font-size:11px;font-weight:bold;padding:2px 10px;border-radius:10px;">${p}</span>`;
}

function sectionBar(n: number, title: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;"><tr><td style="background:${BAR};padding:10px 14px;border-radius:6px 6px 0 0;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:#ffffff;color:${BAR};${FONT}font-size:13px;font-weight:bold;width:24px;height:24px;border-radius:12px;text-align:center;">${n}</td>
<td style="${FONT}font-size:14px;font-weight:bold;color:#ffffff;padding-left:10px;letter-spacing:0.5px;">${esc(title)}</td>
</tr></table></td></tr></table>`;
}

const tableOpen = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid ${BORDER};border-top:none;">`;

const num = (n: number): string =>
  `<span style="${n === 0 ? `color:${MUTED};` : "font-weight:bold;"}">${n}</span>`;

const COLS = ["all", "P1", "P2", "P3", "P4"] as const;
const COL_LABEL: Record<(typeof COLS)[number], string> = { all: "All", P1: "P1", P2: "P2", P3: "P3", P4: "P4" };
const colColor = (c: (typeof COLS)[number]): string => (c === "all" ? TEAL_DARK : PRIORITY_COLOR[c]);
const hasOpen = (c: (typeof COLS)[number]): boolean => c !== "P3" && c !== "P4";

function summarySection(d: SupportReportData): string {
  const sub = (c: (typeof COLS)[number]): string[] =>
    hasOpen(c) ? ["FTD", d.periodLabel, "Open"] : ["FTD", d.periodLabel];
  const groupHead = COLS.map((c) =>
    th(COL_LABEL[c], `background:${colColor(c)};border-left:2px solid #ffffff;`, `colspan="${sub(c).length}"`),
  ).join("");
  const subHead = COLS.map((c) =>
    sub(c)
      .map((label) => th(esc(label), `background:${colColor(c)};opacity:0.9;font-size:11px;`, `data-col="${COL_LABEL[c]}"`))
      .join(""),
  ).join("");

  const cells = (row: SummaryRowKey, bold: boolean): string =>
    COLS.map((c) => {
      const cell = d.summary[row][c];
      const vals = hasOpen(c) ? [cell.ftd, cell.period, cell.open] : [cell.ftd, cell.period];
      return vals.map((v) => td(num(v), `text-align:center;${bold ? "background:#f3f7f8;" : ""}`)).join("");
    }).join("");
  const span = 1 + COLS.reduce((a, c) => a + sub(c).length, 0);
  const label = (t: string, bold = false): string => td(esc(t), `font-weight:${bold ? "bold" : "normal"};`);
  const group = (t: string): string =>
    `<tr><td colspan="${span}" style="${FONT}font-size:11px;font-weight:bold;color:${TEAL_DARK};letter-spacing:1px;background:#eef5f5;padding:6px 10px;">${t}</td></tr>`;
  const row = (r: SummaryRowKey, t: string, bold = false): string =>
    `<tr>${label(t, bold)}${cells(r, bold)}</tr>`;

  return `${sectionBar(1, "SUPPORT TICKET SUMMARY")}${tableOpen}
<tr>${th("Category", `background:${TEAL_DARK};text-align:left;`, 'rowspan="2"')}${groupHead}</tr>
<tr>${subHead}</tr>
${row("bugs", "Total Bugs", true)}
${row("rca", "RCA Shared")}
${row("understanding", CATEGORY_LABELS.understanding)}
${row("data_issue", CATEGORY_LABELS.data_issue)}
${group("REQUESTS RECEIVED")}
${row("data_upload", CATEGORY_LABELS.data_upload)}
${row("image_upload", CATEGORY_LABELS.image_upload)}
${row("others", CATEGORY_LABELS.others)}
${row("total", "Total", true)}
</table>`;
}

function slaSection(d: SupportReportData): string {
  const head =
    th("Metric", `background:${TEAL_DARK};text-align:left;`) +
    PRIORITIES.map((p) => th(p, `background:${PRIORITY_COLOR[p]};`)).join("");
  const row = (label: string, cell: (p: Priority) => string, bold = false): string =>
    `<tr>${td(label, `font-weight:${bold ? "bold" : "normal"};`)}${PRIORITIES.map((p) => td(cell(p), "text-align:center;")).join("")}</tr>`;
  const rows = [
    row(
      "Agreed SLA",
      (p) =>
        `Response: ${formatDuration(d.sla[p].agreed.responseMin)}<br>Resolution: ${formatDuration(d.sla[p].agreed.resolutionMin)}`,
      true,
    ),
    row("Avg Response Time", (p) => formatDuration(d.sla[p].avgResponseMin)),
    row("Avg Resolution Time", (p) => formatDuration(d.sla[p].avgResolutionMin)),
  ].join("");
  return `${sectionBar(2, `SLA REPORT — ${d.periodLabel}`)}${tableOpen}<tr>${head}</tr>${rows}</table>`;
}

function impactSection(d: SupportReportData): string {
  const title = `P1 & P2 TICKET IMPACT REPORT — ${d.periodLabel}`;
  if (d.impact.length === 0) {
    return `${sectionBar(3, title)}${tableOpen}<tr>${td("No P1 / P2 tickets reported.", `color:${MUTED};text-align:center;padding:16px;`)}</tr></table>`;
  }
  const head = ["Issue ID / Heading", "Severity", "Users Reported", "Users Impacted", "RCA Shared"]
    .map((h) => th(h, `background:${TEAL_DARK};`))
    .join("");
  const n = (v: number | null): string => (v == null ? "–" : String(v));
  // Older stored reports predate the RCA toggle and lack the field.
  const yesNo = (v: boolean | undefined): string => (v === undefined ? "–" : v ? "Yes" : "No");
  const rows = d.impact
    .map(
      (i) =>
        `<tr>${td(`<b>${esc(i.jiraKey)}</b> · ${esc(i.summary)}`)}${td(pill(i.priority), "text-align:center;")}${td(n(i.usersReported), "text-align:center;")}${td(n(i.usersImpacted), "text-align:center;")}${td(yesNo(i.rcaShared), "text-align:center;")}</tr>`,
    )
    .join("");
  return `${sectionBar(3, title)}${tableOpen}<tr>${head}</tr>${rows}</table>`;
}

function openBugsSection(d: SupportReportData): string {
  const title = "OPEN BUG DETAIL";
  if (d.openBugs.length === 0) {
    return `${sectionBar(4, title)}${tableOpen}<tr>${td("No open bugs.", `color:${MUTED};text-align:center;padding:16px;`)}</tr></table>`;
  }
  const head = ["Reported On", "Bug ID / Description", "Age", "Priority", "ETA"]
    .map((h) => th(h, `background:${TEAL_DARK};`))
    .join("");
  const rows = d.openBugs
    .map(
      (b) =>
        `<tr>${td(fmtDate(b.createdOn), "white-space:nowrap;")}${td(`<b>${esc(b.jiraKey)}</b> · ${esc(b.summary)}`)}${td(`${b.ageDays} d`, "text-align:center;")}${td(pill(b.priority), "text-align:center;")}${td(b.eta ? fmtDate(b.eta) : "–", "text-align:center;white-space:nowrap;")}</tr>`,
    )
    .join("");
  return `${sectionBar(4, title)}${tableOpen}<tr>${head}</tr>${rows}</table>`;
}

export function renderSupportReportEmail(data: SupportReportData): { subject: string; html: string } {
  const date = fmtDate(data.reportDate);
  const subject = `Issue Report — Daily Update | ${data.projectName} | ${date}`;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f4f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f4f5;"><tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="720" cellpadding="0" cellspacing="0" style="width:100%;max-width:720px;">
<tr><td style="background:${TEAL_DARK};background-image:linear-gradient(135deg,${TEAL_DARK},${TEAL_LIGHT});padding:24px 28px;border-radius:8px 8px 0 0;">
<div style="${FONT}font-size:11px;letter-spacing:2px;color:#bfe3e3;font-weight:bold;">SUPPORT TICKET REPORT</div>
<div style="${FONT}font-size:24px;font-weight:bold;color:#ffffff;margin-top:6px;">Issue Report — Daily Update</div>
<div style="${FONT}font-size:13px;color:#d9eeee;margin-top:8px;">Date: ${esc(date)} · Shared by: ${esc(data.sharedBy)}</div>
</td></tr>
<tr><td style="padding:0 0 4px 0;">
${summarySection(data)}
${slaSection(data)}
${impactSection(data)}
${openBugsSection(data)}
</td></tr>
<tr><td style="height:20px;line-height:20px;font-size:0;">&nbsp;</td></tr>
<tr><td style="background:${TEAL_DARK};padding:14px 20px;border-radius:8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="${FONT}font-size:11px;color:#d9eeee;">Issue Report — ${esc(data.sharedBy)} · FTD = For The Day | ${esc(data.periodLabel)}</td>
<td align="right" style="${FONT}font-size:11px;color:#d9eeee;">Confidential</td>
</tr></table></td></tr>
</table></td></tr></table>
</body></html>`;
  return { subject, html };
}

export function approverNoticeEmail(args: {
  projectName: string;
  reportDate: string;
  reviewUrl: string;
  uncategorisedCount: number;
}): { subject: string; html: string } {
  const date = fmtDate(args.reportDate);
  const subject = `Support report ready for approval — ${args.projectName} — ${date}`;
  const warn =
    args.uncategorisedCount > 0
      ? `<p style="margin:0 0 12px 0;color:#b4452f;">${args.uncategorisedCount} ticket${args.uncategorisedCount === 1 ? " is" : "s are"} uncategorised. Approval is blocked until they are categorised.</p>`
      : "";
  const html = `<!doctype html>
<html><body style="margin:0;padding:20px;background:#f1f4f5;${FONT}color:${TEXT};font-size:14px;">
<div style="max-width:560px;background:#ffffff;padding:24px;border-radius:8px;">
<p style="margin:0 0 12px 0;">The support report for <b>${esc(args.projectName)}</b> (${esc(date)}) is ready for approval.</p>
${warn}
<p style="margin:16px 0 0 0;"><a href="${esc(args.reviewUrl)}" style="display:inline-block;background:${BAR};color:#ffffff;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:6px;">Review report</a></p>
</div></body></html>`;
  return { subject, html };
}
