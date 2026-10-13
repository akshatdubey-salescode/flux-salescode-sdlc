// Header-driven, section-aware parser for the TC template. The team's workbook
// has two column layouts (A: "TEST CASE ID / TC TYPE / ... / DEV STATUS / TESTER
// STATUS", B: "Test Case ID / Module / Test Case Title / ... / QA Status / Dev
// Status"), and a single tab often stacks several SECTIONS: a title row, its own
// header row (possibly a different column order) and cases whose IDs restart at
// TC_001. So columns are found by normalised header text per section, never by
// position, and a case is keyed by section + ID. The input is a plain grid of
// cell values — the same shape comes from the Google Sheets API and from
// ExcelJS — which keeps this module pure and unit-testable.

import {
  cleanValue,
  normalizePriority,
  normalizeResult,
  normalizeSeverity,
  normalizeTypeColumns,
  parseYesNo,
} from "./normalize";
import {
  TC_CATEGORY_VALUES,
  TC_POLARITY_VALUES,
  type TcCategory,
  type TcPolarity,
  type TcPriority,
  type TcResult,
  type TcSeverity,
} from "./values";

export type CanonicalField =
  | "tcId"
  | "classification"
  | "tcType"
  | "severity"
  | "priority"
  | "title"
  | "module"
  | "preconditions"
  | "steps"
  | "expected"
  | "shareWithClient"
  | "devStatus"
  | "devRemarks"
  | "baReview"
  | "baRemarks"
  | "testerStatus"
  | "testerRemarks"
  | "testerMeta"
  | "remark";

/** Normalised header text (see normHeader) to canonical field. */
const HEADER_SYNONYMS: Record<string, CanonicalField> = {
  "test case id": "tcId",
  "tc id": "tcId",
  classification: "classification",
  "tc classification": "classification",
  "tc type": "tcType",
  "test type": "tcType",
  type: "tcType",
  severity: "severity",
  priority: "priority",
  "test case description": "title",
  "test case title": "title",
  title: "title",
  scenario: "title",
  "test case module": "module",
  module: "module",
  precondition: "preconditions",
  preconditions: "preconditions",
  "test step": "steps",
  "test steps": "steps",
  steps: "steps",
  "expected result": "expected",
  "expected results": "expected",
  expected: "expected",
  "share with client": "shareWithClient",
  "dev status": "devStatus",
  "dev remarks": "devRemarks",
  "ba review": "baReview",
  "ba remarks": "baRemarks",
  "tester status": "testerStatus",
  "qa status": "testerStatus",
  "tester remarks": "testerRemarks",
  "qa remarks": "testerRemarks",
  "tester name date app version": "testerMeta",
  remark: "remark",
  remarks: "remark",
};

/** Lower-case, treat newlines and slashes as spaces, drop punctuation. */
export function normHeader(raw: unknown): string {
  return cellText(raw)
    .toLowerCase()
    .replace(/[\n\r/\\]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cell value to display text. Handles ExcelJS rich-text / formula / hyperlink objects. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("").trim();
    }
    if ("result" in o) return cellText(o.result);
    if ("text" in o) return cellText(o.text);
  }
  return "";
}

export type ParsedCase = {
  rowNumber: number;
  tcId: string;
  /** Unique within the sheet: the ID, prefixed with its section when the tab has several. */
  tcKey: string;
  /** Section title (e.g. "Login Backend Logic"), if the section had one. */
  section: string | null;
  sectionNo: number;
  title: string;
  module: string | null;
  polarity: TcPolarity | null;
  category: TcCategory;
  severity: TcSeverity | null;
  priority: TcPriority | null;
  preconditions: string;
  steps: string;
  expected: string;
  shareWithClient: boolean | null;
  devStatus: string;
  devResult: TcResult;
  devRemarks: string;
  baReview: string;
  baRemarks: string;
  testerStatus: string;
  testerResult: TcResult;
  testerRemarks: string;
  testerMeta: string;
  remark: string;
  /** Original header -> value for every non-empty cell, including columns we do not model. */
  raw: Record<string, string>;
};

export type ParseIssue = { row: number | null; severity: "error" | "warning"; message: string };

export type UnmappedValue = { field: string; value: string; count: number };

export type SectionInfo = { no: number; title: string | null; caseCount: number };

export type ParsedSheet =
  | {
      ok: true;
      layout: "A" | "B";
      /** 1-based sheet row of the first header. */
      headerRow: number;
      sections: SectionInfo[];
      cases: ParsedCase[];
      issues: ParseIssue[];
      unmapped: UnmappedValue[];
      categorySplit: Record<TcCategory, number>;
      polaritySplit: Record<TcPolarity, number>;
    }
  | { ok: false; error: string };

const MIN_HEADER_MATCHES = 4;
export const MAX_TC_ROWS = 2000;
/** How many rows after a title row may pass before the header must appear. */
const TITLE_LOOKAHEAD = 2;

/**
 * Column map for a header row, or null if the row is not one. A header needs a
 * Test Case ID column — except that some tabs leave that header cell blank, in
 * which case the blank first column is taken to be the ID.
 */
function headerFieldsOf(row: unknown[] | undefined): Map<number, CanonicalField> | null {
  if (!row) return null;
  const fields = new Map<number, CanonicalField>();
  const seen = new Set<CanonicalField>();
  row.forEach((cell, c) => {
    const f = HEADER_SYNONYMS[normHeader(cell)];
    if (f && !seen.has(f)) {
      seen.add(f);
      fields.set(c, f);
    }
  });
  if (!seen.has("tcId") && cellText(row[0]) === "" && !fields.has(0) && fields.size >= MIN_HEADER_MATCHES) {
    fields.set(0, "tcId");
    seen.add("tcId");
  }
  return seen.has("tcId") && fields.size >= MIN_HEADER_MATCHES ? fields : null;
}

type Section = { no: number; title: string | null; fields: Map<number, CanonicalField>; headerRowIndex: number };

export function parseSheetGrid(grid: unknown[][]): ParsedSheet {
  // ---- pass 1: sections (title row + header row), and the data rows under each
  const sections: Section[] = [];
  const rowSection = new Map<number, Section>();
  let current: Section | null = null;
  let pendingTitle: string | null = null;
  const titleRows = new Set<number>();

  const headerFollows = (r: number): boolean => {
    for (let k = 1; k <= TITLE_LOOKAHEAD + 2 && r + k < grid.length; k++) {
      const next = grid[r + k];
      if (headerFieldsOf(next)) return true;
      if ((next ?? []).some((c) => cellText(c) !== "")) return false; // content before any header: not a title
    }
    return false;
  };

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const fields = headerFieldsOf(row);
    if (fields) {
      current = { no: sections.length + 1, title: pendingTitle, fields, headerRowIndex: r };
      sections.push(current);
      pendingTitle = null;
      continue;
    }
    const texts = [...new Set(row.map(cellText).filter((t) => t !== "").map((t) => t.toLowerCase()))];
    if (texts.length === 1 && headerFollows(r)) {
      pendingTitle = row.map(cellText).find((t) => t !== "") ?? null;
      titleRows.add(r);
      continue;
    }
    if (current) rowSection.set(r, current);
  }

  if (sections.length === 0) {
    return {
      ok: false,
      error:
        "Could not find the header row. Expected a row containing 'Test Case ID' and columns such as Test Case Description/Title, Test Steps and Expected Result.",
    };
  }
  const first = sections[0];
  const firstPresent = new Set(first.fields.values());
  if (!firstPresent.has("title") && !firstPresent.has("steps")) {
    return { ok: false, error: "The sheet has no test case description/title or test steps column." };
  }
  const layout: "A" | "B" = firstPresent.has("tcType") || firstPresent.has("severity") ? "A" : "B";

  // ---- pass 2: cases
  const issues: ParseIssue[] = [];
  const unmappedCounts = new Map<string, UnmappedValue>();
  const noteUnmapped = (field: string, value: string) => {
    const key = `${field}\u0000${value.toLowerCase()}`;
    const ex = unmappedCounts.get(key);
    if (ex) ex.count++;
    else unmappedCounts.set(key, { field, value, count: 1 });
  };

  const cases: ParsedCase[] = [];
  const caseSection: Section[] = [];
  const firstRowOfId = new Map<string, number>();
  const categorySplit = Object.fromEntries(TC_CATEGORY_VALUES.map((t) => [t, 0])) as Record<TcCategory, number>;
  const polaritySplit = Object.fromEntries(TC_POLARITY_VALUES.map((t) => [t, 0])) as Record<TcPolarity, number>;

  for (let r = 0; r < grid.length; r++) {
    const sec = rowSection.get(r);
    if (!sec) continue;
    const row = grid[r] ?? [];
    const rowNumber = r + 1;

    const get = (field: CanonicalField): string => {
      for (const [c, f] of sec.fields) if (f === field) return cellText(row[c]);
      return "";
    };

    const tcId = get("tcId");
    const hasOtherContent = [...sec.fields].some(([c, f]) => f !== "tcId" && cellText(row[c]) !== "");
    if (!tcId) {
      if (hasOtherContent) {
        issues.push({ row: rowNumber, severity: "warning", message: "Row has content but no Test Case ID and was skipped." });
      }
      continue;
    }
    if (cases.length >= MAX_TC_ROWS) {
      return { ok: false, error: `Too many test cases (more than ${MAX_TC_ROWS}). Split the sheet.` };
    }

    const title = get("title");
    const steps = get("steps");
    const expected = get("expected");
    // An ID with nothing else is a stray label, not a test case.
    if (!hasOtherContent) {
      issues.push({ row: rowNumber, severity: "warning", message: `"${tcId}" has no other content and was skipped (a section label?).` });
      continue;
    }

    const dupKey = `${sec.no}\u0000${tcId.toLowerCase()}`;
    const prevRow = firstRowOfId.get(dupKey);
    if (prevRow !== undefined) {
      issues.push({
        row: rowNumber,
        severity: "error",
        message: `Duplicate Test Case ID "${tcId}" in the same section (first seen on row ${prevRow}). IDs must be unique within a section so results can be matched.`,
      });
    } else {
      firstRowOfId.set(dupKey, rowNumber);
    }

    const types = normalizeTypeColumns(get("classification"), get("tcType"));
    for (const u of types.unmatched) noteUnmapped(u.column === "type" ? "TC type" : "Classification", u.value);
    const severity = normalizeSeverity(get("severity"));
    const priority = normalizePriority(get("priority"));
    const dev = normalizeResult(get("devStatus"));
    const tester = normalizeResult(get("testerStatus"));
    if (!severity.matched) noteUnmapped("Severity", get("severity"));
    if (!priority.matched) noteUnmapped("Priority", get("priority"));
    if (!dev.matched) noteUnmapped("Dev status", get("devStatus"));
    if (!tester.matched) noteUnmapped("Tester status", get("testerStatus"));

    if (!title) issues.push({ row: rowNumber, severity: "warning", message: `${tcId}: no description/title.` });
    if (!steps) issues.push({ row: rowNumber, severity: "warning", message: `${tcId}: no test steps.` });
    if (!expected) issues.push({ row: rowNumber, severity: "warning", message: `${tcId}: no expected result.` });

    const raw: Record<string, string> = {};
    (grid[sec.headerRowIndex] ?? []).forEach((h, c) => {
      const label = cellText(h).replace(/\s+/g, " ").trim();
      const value = cellText(row[c]);
      if (label && value) raw[label] = value;
    });

    categorySplit[types.category]++;
    if (types.polarity) polaritySplit[types.polarity]++;
    caseSection.push(sec);
    cases.push({
      rowNumber,
      tcId,
      tcKey: tcId,
      section: sec.title,
      sectionNo: sec.no,
      title,
      module: get("module") || null,
      polarity: types.polarity,
      category: types.category,
      severity: severity.value,
      priority: priority.value,
      preconditions: get("preconditions"),
      steps,
      expected,
      shareWithClient: parseYesNo(get("shareWithClient")),
      devStatus: get("devStatus"),
      devResult: dev.value,
      devRemarks: get("devRemarks"),
      baReview: get("baReview"),
      baRemarks: get("baRemarks"),
      testerStatus: get("testerStatus"),
      testerResult: tester.value,
      testerRemarks: get("testerRemarks"),
      testerMeta: get("testerMeta"),
      remark: get("remark"),
      raw,
    });
  }

  if (cases.length === 0) {
    return { ok: false, error: "The sheet has a header but no test cases (rows with a Test Case ID)." };
  }

  // A tab with several sections keys each case by section + ID, because IDs restart per section.
  const used = sections.filter((s) => cases.some((c) => c.sectionNo === s.no));
  if (used.length > 1) {
    for (const c of cases) c.tcKey = `${c.section ?? `Section ${c.sectionNo}`} / ${c.tcId}`;
  }

  return {
    ok: true,
    layout,
    headerRow: first.headerRowIndex + 1,
    sections: used.map((s) => ({ no: s.no, title: s.title, caseCount: cases.filter((c) => c.sectionNo === s.no).length })),
    cases,
    issues,
    unmapped: [...unmappedCounts.values()].sort((a, b) => b.count - a.count),
    categorySplit,
    polaritySplit,
  };
}

/** True when the visible tab name looks like it belongs to the given Jira key (e.g. "CT-614 (Dry Sampling Exclusion)"). */
export function tabMatchesJiraKey(tabName: string, jiraKey: string): boolean {
  const key = cleanValue(jiraKey);
  if (!key) return false;
  // Whole-key match so "CT-61" does not match "CT-614".
  return new RegExp(`(^|[^a-z0-9])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^0-9])`, "i").test(tabName);
}
