// The downloadable reviewer feedback for one round: who decided what, and every
// comment (round-level and per test case) so the submitter can work through it
// and fix the sheet.

import ExcelJS from "exceljs";
import { TC_REVIEWER_STATE_LABELS, type TcCommentKind, type TcReviewerState } from "./values";

export type FeedbackRow = {
  /** "Round" for round-level comments, "Test case" for per-TC ones. */
  scope: "Round" | "Test case";
  /** The tab and sheet row of the test case (null for round-level comments). */
  tab: string | null;
  row: number | null;
  section: string | null;
  tcCode: string | null;
  title: string | null;
  kind: TcCommentKind;
  body: string;
  author: string;
  at: string;
  resolved: boolean;
};

export type FeedbackReviewer = {
  name: string | null;
  email: string;
  state: TcReviewerState;
  decidedAt: string | null;
};

/** Cells that start with = + - @ would be formulas if the file is later converted to CSV; keep them text. */
export function safeCell(v: string): string {
  return /^[=+\-@]/.test(v) ? `'${v}` : v;
}

const KIND_LABEL: Record<TcCommentKind, string> = {
  comment: "Comment",
  approved: "Approved",
  changes_requested: "Changes requested",
  override: "Override",
};

export async function buildFeedbackXlsx(args: {
  issueKey: string;
  issueSummary: string;
  roundLabel: string;
  generatedAt: string;
  /** What the round reviewed ("Main rows 12-40 (28 of 142 TCs); ..."), so feedback can be tied to the right part of a shared sheet. */
  scopeText?: string;
  reviewers: FeedbackReviewer[];
  rows: FeedbackRow[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Flux";
  wb.created = new Date();

  const summary = wb.addWorksheet("Summary");
  summary.addRows([
    ["Issue", safeCell(`${args.issueKey} — ${args.issueSummary}`)],
    ["Round", args.roundLabel],
    ...(args.scopeText ? [["Reviewed", safeCell(args.scopeText)]] : []),
    ["Generated", args.generatedAt],
    [],
    ["Reviewer", "Email", "Decision", "Decided at"],
    ...args.reviewers.map((r) => [
      safeCell(r.name ?? r.email),
      r.email,
      TC_REVIEWER_STATE_LABELS[r.state],
      r.decidedAt ?? "",
    ]),
  ]);
  summary.getColumn(1).width = 28;
  summary.getColumn(2).width = 34;
  summary.getColumn(3).width = 20;
  summary.getColumn(4).width = 24;
  summary.getRow(args.scopeText ? 6 : 5).font = { bold: true };

  const ws = wb.addWorksheet("Feedback", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(["Scope", "Tab", "Row", "Section", "TC ID", "Test case", "Type", "Feedback", "By", "At", "Resolved"]);
  ws.getRow(1).font = { bold: true };
  for (const r of args.rows) {
    ws.addRow([
      r.scope,
      safeCell(r.tab ?? ""),
      r.row ?? "",
      safeCell(r.section ?? ""),
      safeCell(r.tcCode ?? ""),
      safeCell(r.title ?? ""),
      KIND_LABEL[r.kind],
      safeCell(r.body),
      safeCell(r.author),
      r.at,
      r.resolved ? "Yes" : "No",
    ]);
  }
  [12, 18, 7, 26, 12, 40, 18, 70, 24, 22, 10].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.eachRow((row) => row.eachCell((c) => (c.alignment = { vertical: "top", wrapText: true })));

  return Buffer.from(await wb.xlsx.writeBuffer());
}
