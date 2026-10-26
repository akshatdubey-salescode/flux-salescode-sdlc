// Which part of a shared sheet belongs to an item: tabs, and optionally the rows of each tab.
//
// One link is often kept for many features, so a submission names its tabs and, per tab, the sheet rows (as shown in
// Google Sheets / Excel) that hold its test cases. Everything here is pure (no database, no network) so it can be tested.
//
// Rows are sheet row numbers, 1-based, inclusive. A tab without rows means the whole tab. When no tab is named at all,
// every visible test-case tab is reviewed and the round says so (`defaulted`).

export type RowRange = [number, number];

export const MAX_RANGES_PER_TAB = 50;
export const MAX_SHEET_ROW = 100_000;

export type RowSpecResult = { ok: true; ranges: RowRange[]; text: string } | { ok: false; error: string };

/**
 * "12-40, 55, 60-70" -> sorted, merged ranges. Accepts commas, semicolons, spaces and new lines between parts, "-", an en
 * dash or ":" inside a part, and cell-style references such as "A12:F40" (the letters are ignored: only rows matter).
 */
export function parseRowSpec(input: string): RowSpecResult {
  const text = (input ?? "").trim();
  if (text === "") return { ok: false, error: "Enter the rows, for example 12-40, 55." };
  // "12 - 40" is one range; spaces between parts separate them.
  const tight = text.replace(/\s*([-\u2013\u2014:])\s*/g, "$1");
  const parts = tight.split(/[,;\n]+|\s+(?=[A-Za-z]*\d)/).map((p) => p.trim()).filter(Boolean);
  const ranges: RowRange[] = [];
  for (const part of parts) {
    const m = part.match(/^[A-Za-z]{0,3}(\d+)\s*(?:[-–—:]\s*[A-Za-z]{0,3}(\d+))?$/);
    if (!m) return { ok: false, error: `"${part}" is not a row or a range. Use rows like 12-40, 55.` };
    const start = Number(m[1]);
    const end = m[2] !== undefined ? Number(m[2]) : start;
    if (start < 1 || end < 1) return { ok: false, error: `"${part}": rows start at 1.` };
    if (start > MAX_SHEET_ROW || end > MAX_SHEET_ROW) return { ok: false, error: `"${part}": rows go up to ${MAX_SHEET_ROW}.` };
    if (start > end) return { ok: false, error: `"${part}": the first row is after the last row.` };
    ranges.push([start, end]);
  }
  const merged = mergeRanges(ranges);
  if (merged.length > MAX_RANGES_PER_TAB) return { ok: false, error: `Use at most ${MAX_RANGES_PER_TAB} ranges per tab (merge neighbouring ones).` };
  return { ok: true, ranges: merged, text: formatRanges(merged) };
}

/** Sorts and merges overlapping or touching ranges. */
export function mergeRanges(ranges: RowRange[]): RowRange[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: RowRange[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

export function formatRanges(ranges: RowRange[]): string {
  return ranges.map(([s, e]) => (s === e ? String(s) : `${s}-${e}`)).join(", ");
}

export function inRanges(row: number, ranges: RowRange[] | null | undefined): boolean {
  if (!ranges) return true;
  for (const [s, e] of ranges) if (row >= s && row <= e) return true;
  return false;
}

/** Rows asked for per tab (title -> ranges; a tab missing from the map, or null, means every row). */
export type ScopeInput = Map<string, RowRange[] | null>;

export type ScopeField = { ok: true; scope: ScopeInput; rows: Map<string, string> } | { ok: false; error: string };

/** The form's `scope` field: JSON like [{"tab":"Main","rows":"12-40, 55"},{"tab":"Extra","rows":""}]. */
export function parseScopeField(raw: FormDataEntryValue | null | undefined): ScopeField {
  if (raw === null || raw === undefined || raw === "") return { ok: true, scope: new Map(), rows: new Map() };
  let value: unknown;
  try {
    value = JSON.parse(String(raw));
  } catch {
    return { ok: false, error: "Invalid row selection." };
  }
  if (!Array.isArray(value)) return { ok: false, error: "Invalid row selection." };
  const scope: ScopeInput = new Map();
  const rows = new Map<string, string>();
  for (const item of value) {
    const tab = typeof item?.tab === "string" ? item.tab : "";
    const spec = typeof item?.rows === "string" ? item.rows.trim() : "";
    if (!tab) return { ok: false, error: "Invalid row selection." };
    if (spec === "") continue; // whole tab
    const parsed = parseRowSpec(spec);
    if (!parsed.ok) return { ok: false, error: `Tab "${tab}": ${parsed.error}` };
    scope.set(tab, parsed.ranges);
    rows.set(tab, parsed.text);
  }
  return { ok: true, scope, rows };
}

// ---------------------------------------------------------------------------
// What a round stores about its scope (tc_rounds.scope)
// ---------------------------------------------------------------------------

export type ScopeEntry = {
  tab: string;
  /** Normalised row spec ("12-40, 55"), or null for the whole tab. */
  rows: string | null;
  ranges: RowRange[] | null;
  /** Google Sheets tab id, for links into the live sheet. */
  gid: number | null;
  /** Test cases the tab holds in total, and how many of them this round covers. */
  totalInTab: number;
  inScope: number;
  /** First and last test case in scope (their IDs and sheet rows): used to realign the rows if the sheet changes. */
  firstId: string | null;
  lastId: string | null;
  firstRow: number | null;
  lastRow: number | null;
};

export type RoundScope = {
  /** No tab was named, so every visible test-case tab was reviewed. */
  defaulted: boolean;
  /** Tabs left out in that mode because they are not test-case sheets. */
  skipped: { tab: string; reason: string }[];
  tabs: ScopeEntry[];
};

/** One line saying what was reviewed, e.g. "Main rows 12-40 (28 of 142 TCs); Extra: all rows (14 TCs)". */
export function describeScope(scope: RoundScope | null | undefined, fallbackTabs: string[] = []): string {
  if (!scope || scope.tabs.length === 0) {
    return fallbackTabs.length > 0 ? `${fallbackTabs.join(", ")}: all rows` : "All rows of the chosen tabs";
  }
  const parts = scope.tabs.map((t) =>
    t.rows ? `${t.tab} rows ${t.rows} (${t.inScope} of ${t.totalInTab} TCs)` : `${t.tab}: all rows (${t.inScope} TC${t.inScope === 1 ? "" : "s"})`,
  );
  const line = parts.join("; ");
  return scope.defaulted ? `All tabs (none was named): ${line}` : line;
}

/** Short form for a tab chip or a table cell: "rows 12-40" or "all rows". */
export function tabRowsLabel(entry: Pick<ScopeEntry, "rows"> | undefined): string {
  return entry?.rows ? `rows ${entry.rows}` : "all rows";
}

/** The scope entry for a tab, if the round has one. */
export function entryFor(scope: RoundScope | null | undefined, tab: string): ScopeEntry | undefined {
  return scope?.tabs.find((t) => t.tab === tab);
}
