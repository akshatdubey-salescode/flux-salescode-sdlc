import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth } from "@/lib/auth/server";
import {
  fetchPeopleProjects,
  fetchPersonRepoContributions,
  fetchOwnedBugs,
  fetchUnattributedBugs,
  type PersonProjectsRow,
  type PersonRepoContribution,
  type OwnedBug,
  type UnattributedBug,
} from "@/app/(app)/views/people-projects/data";
import { filterPeopleProjects } from "@/app/(app)/views/people-projects/filter";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  await requireAuth();

  const { searchParams } = req.nextUrl;
  const start = searchParams.get("start") ?? "";
  const end = searchParams.get("end") ?? "";
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) {
    return new Response("start and end must be YYYY-MM-DD", { status: 400 });
  }

  const q = (searchParams.get("q") ?? "").trim().slice(0, 100);
  const departments = (searchParams.get("dept") ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  const [allPeople, allRepos, allBugs, unownedBugs] = await Promise.all([
    fetchPeopleProjects(start, end),
    fetchPersonRepoContributions(start, end),
    fetchOwnedBugs(start, end),
    fetchUnattributedBugs(start, end),
  ]);

  const people = filterPeopleProjects(allPeople, q, departments);
  // Detail sheets cover exactly the people left after the on-screen filters.
  // (Unowned bugs have no person, so that sheet is never people-filtered.)
  const emails = new Set(people.map((p) => p.email));
  const repos = allRepos.filter((r) => emails.has(r.email));
  const bugs = allBugs.filter((b) => emails.has(b.email));

  const buffer = await buildWorkbook(
    people,
    repos,
    bugs,
    unownedBugs,
    start,
    end,
    q,
    departments
  );

  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="people-projects-${start}-to-${end}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

// ---- Workbook styling (matches the My Tasks export) -------------------------

// Brand palette (ARGB — 8-digit hex, alpha first).
const TEAL = "FF0D9488";
const TEAL_DARK = "FF0F766E";
const ZEBRA = "FFF0FDFA";
const BORDER = "FFE5E7EB";
const TEXT = "FF111827";
const MUTED = "FF6B7280";

function priorityColor(priority: string | null): string | null {
  const p = (priority ?? "").toLowerCase();
  if (p === "p1" || p === "highest") return "FFB91C1C"; // red
  if (p === "p2" || p === "high") return "FFC2410C"; // orange
  if (p === "p3" || p === "medium") return "FFB45309"; // amber
  if (p === "p4" || p === "low") return "FF047857"; // green
  if (p === "p5" || p === "lowest") return "FF6B7280"; // gray
  return null;
}

type Col = {
  header: string;
  width: number;
  min: number;
  max: number;
  numeric?: boolean;
  date?: boolean;
  wrap?: boolean;
  muted?: boolean;
  bold?: boolean;
};

type CellVal =
  | string
  | number
  | Date
  | { text: string; hyperlink: string }
  | { text: string; color: string }
  | null;

/** Adds one worksheet in the shared Flux export theme: title banner,
 *  subtitle, styled header, zebra data rows, measured column widths,
 *  auto-filter, frozen header. */
function addStyledSheet(
  wb: ExcelJS.Workbook,
  name: string,
  title: string,
  subtitle: string,
  cols: Col[],
  rows: CellVal[][]
) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 3 }] });
  const colCount = cols.length;

  ws.mergeCells(1, 1, 1, colCount);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_DARK } };
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, colCount);
  const subCell = ws.getCell(2, 1);
  subCell.value = subtitle;
  subCell.font = { name: "Calibri", size: 10, color: { argb: "FFFFFFFF" }, italic: true };
  subCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
  ws.getRow(2).height = 18;

  const headerRow = ws.getRow(3);
  cols.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    cell.border = {
      top: { style: "thin", color: { argb: TEAL } },
      bottom: { style: "thin", color: { argb: TEAL } },
      left: { style: "thin", color: { argb: TEAL } },
      right: { style: "thin", color: { argb: TEAL } },
    };
  });
  headerRow.height = 22;

  const widths = cols.map((c) => c.header.length);

  rows.forEach((row, idx) => {
    const wsRow = ws.getRow(idx + 4);
    const zebra = idx % 2 === 1;

    cols.forEach((col, ci) => {
      const cell = wsRow.getCell(ci + 1);
      const value = row[ci];
      let display = "";

      if (value === null || value === undefined) {
        cell.value = "";
        cell.font = { name: "Calibri", size: 11, color: { argb: TEXT } };
      } else if (value instanceof Date) {
        cell.value = value;
        cell.numFmt = "dd MMM yyyy";
        display = "dd MMM yyyy";
        cell.font = { name: "Calibri", size: 10, color: { argb: MUTED } };
      } else if (typeof value === "object" && "hyperlink" in value) {
        cell.value = { text: value.text, hyperlink: value.hyperlink };
        display = value.text;
        cell.font = {
          name: "Calibri",
          size: 11,
          color: { argb: TEAL_DARK },
          underline: true,
          bold: true,
        };
      } else if (typeof value === "object" && "color" in value) {
        cell.value = value.text;
        display = value.text;
        cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: value.color } };
      } else {
        cell.value = value;
        display = String(value);
        cell.font = {
          name: "Calibri",
          size: col.muted ? 10 : 11,
          bold: !!col.bold,
          color: { argb: col.muted ? MUTED : TEXT },
        };
      }

      cell.alignment = {
        vertical: "top",
        horizontal: col.numeric ? "right" : "left",
        indent: 1,
        wrapText: !!col.wrap,
      };
      cell.border = {
        bottom: { style: "hair", color: { argb: BORDER } },
        right: { style: "hair", color: { argb: BORDER } },
      };
      if (zebra) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      }

      if (display && !col.wrap) {
        widths[ci] = Math.max(widths[ci], display.length);
      }
    });
  });

  cols.forEach((col, i) => {
    const measured = col.wrap ? col.width : widths[i] + 3;
    ws.getColumn(i + 1).width = Math.min(col.max, Math.max(col.min, measured));
  });

  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: colCount } };
}

async function buildWorkbook(
  people: PersonProjectsRow[],
  repos: PersonRepoContribution[],
  bugs: OwnedBug[],
  unownedBugs: UnattributedBug[],
  start: string,
  end: string,
  q: string,
  departments: string[]
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Flux";
  wb.created = new Date();

  const generatedOn = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const filterNote = [
    departments.length ? `Departments: ${departments.join(", ")}` : "",
    q ? `Search: "${q}"` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const stamp = `${start} to ${end}${filterNote ? ` · ${filterNote}` : ""} · Exported ${generatedOn}`;

  const nameByEmail = new Map(people.map((p) => [p.email, p.name]));

  // --- Sheet 1: one row per person ---
  addStyledSheet(
    wb,
    "Summary",
    "People & Projects — Summary",
    `${people.length} ${people.length === 1 ? "person" : "people"} · ${stamp}`,
    [
      { header: "Person", width: 22, min: 14, max: 30, bold: true },
      { header: "Email", width: 28, min: 18, max: 36, muted: true },
      { header: "Department", width: 18, min: 12, max: 26 },
      { header: "Job Title", width: 20, min: 12, max: 30 },
      { header: "Manager", width: 20, min: 12, max: 28, muted: true },
      { header: "Projects", width: 10, min: 8, max: 12, numeric: true },
      { header: "Issues / Tasks", width: 14, min: 12, max: 16, numeric: true },
      { header: "Open", width: 10, min: 8, max: 12, numeric: true },
      { header: "P1 Bugs", width: 10, min: 8, max: 12, numeric: true },
      { header: "P2 Bugs", width: 10, min: 8, max: 12, numeric: true },
      { header: "P3 Bugs", width: 10, min: 8, max: 12, numeric: true },
      { header: "Total Bugs", width: 12, min: 10, max: 14, numeric: true },
      { header: "Net LOC", width: 12, min: 10, max: 14, numeric: true },
      { header: "LOC Added", width: 12, min: 10, max: 14, numeric: true },
      { header: "LOC Deleted", width: 13, min: 11, max: 15, numeric: true },
    ],
    people.map((p) => [
      p.name,
      p.email,
      p.department ?? "",
      p.jobTitle ?? "",
      p.managerName ?? "",
      p.projects.length,
      p.totalIssues,
      p.totalOpen,
      p.totalP1Bugs,
      p.totalP2Bugs,
      p.totalP3Bugs,
      p.totalBugs,
      p.locNet,
      p.locAdditions,
      p.locDeletions,
    ])
  );

  // --- Sheet 2: one row per person × project ---
  const pairRows = people.flatMap((p) =>
    p.projects.map((proj) => [
      p.name,
      p.email,
      proj.projectName,
      proj.projectKey,
      proj.issueCount,
      proj.openCount,
      proj.completedInWindow,
      proj.p1Bugs,
      proj.p2Bugs,
      proj.p3Bugs,
      proj.bugTotal,
    ])
  );
  addStyledSheet(
    wb,
    "By Project",
    "People & Projects — By Project",
    `${pairRows.length} person–project rows · ${stamp}`,
    [
      { header: "Person", width: 22, min: 14, max: 30, bold: true },
      { header: "Email", width: 28, min: 18, max: 36, muted: true },
      { header: "Project", width: 28, min: 16, max: 40 },
      { header: "Project Key", width: 12, min: 10, max: 16 },
      { header: "Issues / Tasks", width: 14, min: 12, max: 16, numeric: true },
      { header: "Open", width: 10, min: 8, max: 12, numeric: true },
      { header: "Completed in Period", width: 18, min: 14, max: 22, numeric: true },
      { header: "P1 Bugs", width: 10, min: 8, max: 12, numeric: true },
      { header: "P2 Bugs", width: 10, min: 8, max: 12, numeric: true },
      { header: "P3 Bugs", width: 10, min: 8, max: 12, numeric: true },
      { header: "Total Bugs", width: 12, min: 10, max: 14, numeric: true },
    ],
    pairRows
  );

  // --- Sheet 3: one row per person × repo ---
  addStyledSheet(
    wb,
    "Repos",
    "GitHub Contributions by Repo",
    `${repos.length} person–repo rows · ${stamp}`,
    [
      { header: "Person", width: 22, min: 14, max: 30, bold: true },
      { header: "Email", width: 28, min: 18, max: 36, muted: true },
      { header: "Repository", width: 36, min: 20, max: 50 },
      { header: "Commits", width: 10, min: 8, max: 12, numeric: true },
      { header: "LOC Added", width: 12, min: 10, max: 14, numeric: true },
      { header: "LOC Deleted", width: 13, min: 11, max: 15, numeric: true },
      { header: "Net LOC", width: 12, min: 10, max: 14, numeric: true },
    ],
    repos.map((r) => [
      nameByEmail.get(r.email) ?? r.email.split("@")[0],
      r.email,
      r.repoFullName,
      r.commits,
      r.additions,
      r.deletions,
      r.net,
    ])
  );

  // --- Sheet 4: one row per owner-attributed bug (every priority) ---
  addStyledSheet(
    wb,
    "Bugs",
    "Owned Bugs Created in Period",
    `${bugs.length} bug${bugs.length === 1 ? "" : "s"} · all priorities · ${stamp}`,
    [
      { header: "Owner", width: 22, min: 14, max: 30, bold: true },
      { header: "Owner Email", width: 28, min: 18, max: 36, muted: true },
      { header: "Project", width: 24, min: 14, max: 34 },
      { header: "Jira Key", width: 14, min: 10, max: 18 },
      { header: "Summary", width: 50, min: 30, max: 60, wrap: true },
      { header: "Priority", width: 10, min: 8, max: 12 },
      { header: "Status", width: 16, min: 10, max: 24 },
      { header: "Created", width: 13, min: 12, max: 14 },
    ],
    bugs.map((b) => [
      b.ownerName ?? nameByEmail.get(b.email) ?? b.email.split("@")[0],
      b.email,
      b.projectName,
      { text: b.jiraKey, hyperlink: b.browseUrl },
      b.summary,
      b.priority
        ? { text: b.priority, color: priorityColor(b.priority) ?? TEXT }
        : "",
      b.status,
      b.createdAt ? new Date(b.createdAt) : null,
    ])
  );

  // --- Sheet 5: bugs with no issue owner (data-hygiene; not people-filtered) ---
  addStyledSheet(
    wb,
    "Unowned Bugs",
    "Bugs Missing an Issue Owner",
    `${unownedBugs.length} bug${unownedBugs.length === 1 ? "" : "s"} with no owner set · not counted for anyone · not affected by people filters · ${stamp}`,
    [
      { header: "Project", width: 24, min: 14, max: 34 },
      { header: "Jira Key", width: 14, min: 10, max: 18 },
      { header: "Summary", width: 50, min: 30, max: 60, wrap: true },
      { header: "Priority", width: 10, min: 8, max: 12 },
      { header: "Status", width: 16, min: 10, max: 24 },
      { header: "Assignee", width: 22, min: 14, max: 30 },
      { header: "Assignee Email", width: 28, min: 18, max: 36, muted: true },
      { header: "Created", width: 13, min: 12, max: 14 },
    ],
    unownedBugs.map((b) => [
      b.projectName,
      { text: b.jiraKey, hyperlink: b.browseUrl },
      b.summary,
      b.priority
        ? { text: b.priority, color: priorityColor(b.priority) ?? TEXT }
        : "",
      b.status,
      b.assigneeName ?? "",
      b.assigneeEmail ?? "",
      b.createdAt ? new Date(b.createdAt) : null,
    ])
  );

  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}
