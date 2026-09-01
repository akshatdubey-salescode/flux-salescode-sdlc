import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth } from "@/lib/auth/server";
import {
  fetchPeopleProjects,
  type PersonProjectsRow,
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

  const rows = filterPeopleProjects(
    await fetchPeopleProjects(start, end),
    q,
    departments
  );
  const buffer = await buildWorkbook(rows, start, end, q, departments);

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

type FlatRow = {
  name: string;
  email: string;
  department: string;
  jobTitle: string;
  manager: string;
  project: string;
  projectKey: string;
  issueCount: number;
  openCount: number;
  completedInWindow: number;
};

const COLUMNS: {
  header: string;
  key: keyof FlatRow;
  width: number;
  min: number;
  max: number;
  numeric?: boolean;
}[] = [
  { header: "Person", key: "name", width: 22, min: 14, max: 30 },
  { header: "Email", key: "email", width: 28, min: 18, max: 36 },
  { header: "Department", key: "department", width: 18, min: 12, max: 26 },
  { header: "Job Title", key: "jobTitle", width: 20, min: 12, max: 30 },
  { header: "Manager", key: "manager", width: 20, min: 12, max: 28 },
  { header: "Project", key: "project", width: 28, min: 16, max: 40 },
  { header: "Project Key", key: "projectKey", width: 12, min: 10, max: 16 },
  { header: "Issues / Tasks", key: "issueCount", width: 14, min: 12, max: 16, numeric: true },
  { header: "Open", key: "openCount", width: 10, min: 8, max: 12, numeric: true },
  { header: "Completed in Period", key: "completedInWindow", width: 18, min: 14, max: 22, numeric: true },
];

async function buildWorkbook(
  people: PersonProjectsRow[],
  start: string,
  end: string,
  q: string,
  departments: string[]
): Promise<ArrayBuffer> {
  const flat: FlatRow[] = people.flatMap((person) =>
    person.projects.map((p) => ({
      name: person.name,
      email: person.email,
      department: person.department ?? "",
      jobTitle: person.jobTitle ?? "",
      manager: person.managerName ?? "",
      project: p.projectName,
      projectKey: p.projectKey,
      issueCount: p.issueCount,
      openCount: p.openCount,
      completedInWindow: p.completedInWindow,
    }))
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = "Flux";
  wb.created = new Date();

  const ws = wb.addWorksheet("People x Projects", {
    views: [{ state: "frozen", ySplit: 3 }],
  });

  const colCount = COLUMNS.length;

  // --- Title banner (rows 1-2) ---
  ws.mergeCells(1, 1, 1, colCount);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = "People & Projects";
  titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_DARK } };
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, colCount);
  const subCell = ws.getCell(2, 1);
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
  subCell.value = `${people.length} ${people.length === 1 ? "person" : "people"} · ${start} to ${end}${filterNote ? ` · ${filterNote}` : ""} · Exported ${generatedOn}`;
  subCell.font = { name: "Calibri", size: 10, color: { argb: "FFFFFFFF" }, italic: true };
  subCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
  ws.getRow(2).height = 18;

  // --- Header row (row 3) ---
  const headerRow = ws.getRow(3);
  COLUMNS.forEach((col, i) => {
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

  // Track max content length per column for auto-width.
  const widths = COLUMNS.map((c) => c.header.length);

  // --- Data rows ---
  flat.forEach((row, idx) => {
    const wsRow = ws.getRow(idx + 4);
    const zebra = idx % 2 === 1;

    COLUMNS.forEach((col, ci) => {
      const cell = wsRow.getCell(ci + 1);
      const value = row[col.key];

      if (col.numeric) {
        cell.value = value as number;
        cell.font = { name: "Calibri", size: 11, color: { argb: TEXT } };
        cell.alignment = { vertical: "top", horizontal: "right", indent: 1 };
      } else {
        cell.value = value as string;
        cell.font = {
          name: "Calibri",
          size: col.key === "email" || col.key === "manager" ? 10 : 11,
          bold: col.key === "name",
          color: { argb: col.key === "email" || col.key === "manager" ? MUTED : TEXT },
        };
        cell.alignment = { vertical: "top", horizontal: "left", indent: 1 };
      }

      cell.border = {
        bottom: { style: "hair", color: { argb: BORDER } },
        right: { style: "hair", color: { argb: BORDER } },
      };
      if (zebra) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      }

      const display = String(value ?? "");
      if (display) {
        widths[ci] = Math.max(widths[ci], display.length);
      }
    });
  });

  // --- Apply computed column widths (clamped) + filter ---
  COLUMNS.forEach((col, i) => {
    ws.getColumn(i + 1).width = Math.min(col.max, Math.max(col.min, widths[i] + 3));
  });

  ws.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: colCount },
  };

  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}
