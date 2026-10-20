// The downloadable analytics summary for one issue's test cases: the same
// numbers as the details page (they come from the stored stats, not a second
// calculation), plus the per-case results.

import ExcelJS from "exceljs";
import { READINESS_LABELS, type ResultCounts, type SetStats, type TypeRow } from "./analytics";
import { safeCell } from "./feedback-xlsx";
import { TC_CATEGORY_LABELS, TC_POLARITY_LABELS, type TcCategory, type TcPolarity, type TcResult } from "./values";

export type SummaryCase = {
  section: string | null;
  tcCode: string;
  title: string;
  category: string;
  polarity: string | null;
  priority: string | null;
  severity: string | null;
  /** null = that role has not signed off. */
  dev: TcResult | null;
  tester: TcResult | null;
  effective: TcResult;
};

export type SummaryInput = {
  issueKey: string;
  issueSummary: string;
  projectName: string;
  roundLabel: string;
  generatedAt: string;
  stats: SetStats;
  trend: { roundNo: number; tcCount: number; quality: number; passRate: number; confidence: number; status: string }[];
  signoffs: { role: "dev" | "tester"; by: string; label: string; pass: number; fail: number; blocked: number; notRun: number; notes: string | null; current: boolean }[];
  cases: SummaryCase[];
};

const RESULT_LABEL: Record<TcResult, string> = { pass: "Passed", fail: "Failed", blocked: "Blocked", not_run: "Not run" };
const HEADER_FONT = { bold: true } as const;

function bold(row: ExcelJS.Row) {
  row.font = HEADER_FONT;
}

function splitTable(ws: ExcelJS.Worksheet, title: string, firstCol: string, rows: { name: string; counts: ResultCounts }[]) {
  ws.addRow([title]).font = { bold: true, size: 12 };
  const head = ws.addRow([firstCol, "Total", "Passed", "Failed", "Blocked", "Not run"]);
  bold(head);
  for (const r of rows) {
    ws.addRow([safeCell(r.name), r.counts.total, r.counts.pass, r.counts.fail, r.counts.blocked, r.counts.not_run]);
  }
  ws.addRow([]);
}

function rowsOf<K extends string>(split: Partial<Record<K, TypeRow>>, label: (k: K) => string) {
  return (Object.entries(split) as [K, TypeRow][])
    .filter(([, r]) => r.total > 0)
    .map(([k, r]) => ({ name: label(k), counts: r.effective }))
    .sort((a, b) => b.counts.total - a.counts.total);
}

export async function buildSummaryXlsx(input: SummaryInput): Promise<Buffer> {
  const { stats } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Flux";
  wb.created = new Date();

  // --- Summary --------------------------------------------------------------
  const s = wb.addWorksheet("Summary");
  s.getColumn(1).width = 30;
  s.getColumn(2).width = 60;
  s.addRows([
    ["Issue", safeCell(`${input.issueKey} — ${input.issueSummary}`)],
    ["Project", safeCell(input.projectName)],
    ["Latest round", input.roundLabel],
    ["Generated", input.generatedAt],
    [],
    ["Delivery confidence", `${stats.confidence}%`],
    ["Readiness", READINESS_LABELS[stats.readiness]],
    ["Execution score", stats.executionScore],
    ["Quality (estimated)", stats.quality],
    ["Pass rate", `${stats.passRate}%`],
    ["Executed", `${stats.executedPct}%`],
    [],
    ["Test cases", stats.tcCount],
    ["Passed", stats.effective.pass],
    ["Failed", stats.effective.fail],
    ["Blocked", stats.effective.blocked],
    ["Not run", stats.effective.not_run],
    [],
    ["Reviewer approved", `${stats.reviewersApproved} of ${stats.reviewersTotal}`],
    ["Developer signed off", stats.dev.signedOff ? "Yes" : "No"],
    ["Tester signed off", stats.tester.signedOff ? "Yes" : "No"],
    ["LLM reviewed", stats.llmReviewed ? "Yes" : "Not enabled yet"],
    ["Reviewer feedback", `${stats.feedbackOpen} open of ${stats.feedbackTotal}`],
    [],
    ["Quality breakdown (0-100)", ""],
    ["Completeness (weight 30)", stats.qualityComponents.completeness],
    ["Positive / negative / edge mix (weight 25)", stats.qualityComponents.diversity],
    ["No duplicates (weight 20)", stats.qualityComponents.uniqueness],
    ["Priority coverage (weight 15)", stats.qualityComponents.priorityCoverage],
    ["ID hygiene (weight 10)", stats.qualityComponents.idHygiene],
  ]);
  if (stats.qualityComponents.changesRequestedPenalty > 0) {
    s.addRow(["Reviewer changes outstanding", -stats.qualityComponents.changesRequestedPenalty]);
  }
  if (stats.confidenceCaps.length > 0) {
    s.addRow([]);
    s.addRow(["Confidence limited by", ""]).font = HEADER_FONT;
    for (const cap of stats.confidenceCaps) s.addRow(["", safeCell(cap)]);
  }
  for (const label of ["Delivery confidence", "Readiness", "Quality breakdown (0-100)"]) {
    const row = s.getRows(1, s.rowCount)?.find((r) => r.getCell(1).value === label);
    if (row) row.getCell(1).font = HEADER_FONT;
  }

  // --- Breakdown ------------------------------------------------------------
  const b = wb.addWorksheet("Breakdown");
  [30, 10, 10, 10, 10, 10].forEach((w, i) => (b.getColumn(i + 1).width = w));
  splitTable(b, "By category (effective result)", "Category", rowsOf(stats.categorySplit, (k) => TC_CATEGORY_LABELS[k as TcCategory] ?? k));
  splitTable(b, "By type (effective result)", "Type", rowsOf(stats.polaritySplit, (k) => (k === "unspecified" ? "Unspecified" : (TC_POLARITY_LABELS[k as TcPolarity] ?? k))));
  splitTable(b, "By priority (effective result)", "Priority", rowsOf(stats.prioritySplit, (k) => (k === "none" ? "No priority" : String(k))));
  const roleRows: { name: string; counts: ResultCounts }[] = [];
  if (stats.dev.signedOff) roleRows.push({ name: "Developer", counts: stats.dev });
  if (stats.tester.signedOff) roleRows.push({ name: "Tester", counts: stats.tester });
  splitTable(b, "By role", "Role", roleRows);

  // --- Rounds ---------------------------------------------------------------
  const r = wb.addWorksheet("Rounds", { views: [{ state: "frozen", ySplit: 1 }] });
  bold(r.addRow(["Round", "Status", "Test cases", "Quality", "Pass rate %", "Confidence"]));
  for (const t of input.trend) r.addRow([`Round ${t.roundNo}`, t.status, t.tcCount, t.quality, t.passRate, t.confidence]);
  [12, 20, 12, 10, 12, 12].forEach((w, i) => (r.getColumn(i + 1).width = w));

  // --- Sign-offs ------------------------------------------------------------
  const so = wb.addWorksheet("Sign-offs", { views: [{ state: "frozen", ySplit: 1 }] });
  bold(so.addRow(["Role", "By", "When", "Passed", "Failed", "Blocked", "Not run", "Counts", "Notes"]));
  for (const x of input.signoffs) {
    so.addRow([
      x.role === "dev" ? "Developer" : "Tester",
      safeCell(x.by),
      x.label,
      x.pass,
      x.fail,
      x.blocked,
      x.notRun,
      x.current ? "Current" : "Replaced",
      safeCell(x.notes ?? ""),
    ]);
  }
  [12, 26, 24, 9, 9, 9, 9, 10, 50].forEach((w, i) => (so.getColumn(i + 1).width = w));

  // --- Cases ----------------------------------------------------------------
  const c = wb.addWorksheet("Cases", { views: [{ state: "frozen", ySplit: 1 }] });
  bold(c.addRow(["Section", "TC ID", "Title", "Category", "Type", "Priority", "Severity", "Developer", "Tester", "Result"]));
  for (const x of input.cases) {
    c.addRow([
      safeCell(x.section ?? ""),
      safeCell(x.tcCode),
      safeCell(x.title),
      TC_CATEGORY_LABELS[x.category as TcCategory] ?? x.category,
      x.polarity ? (TC_POLARITY_LABELS[x.polarity as TcPolarity] ?? x.polarity) : "",
      x.priority ?? "",
      x.severity ? x.severity[0].toUpperCase() + x.severity.slice(1) : "",
      x.dev ? RESULT_LABEL[x.dev] : "No sign-off",
      x.tester ? RESULT_LABEL[x.tester] : "No sign-off",
      RESULT_LABEL[x.effective],
    ]);
  }
  [26, 10, 60, 16, 12, 9, 10, 12, 12, 10].forEach((w, i) => (c.getColumn(i + 1).width = w));

  return Buffer.from(await wb.xlsx.writeBuffer());
}
