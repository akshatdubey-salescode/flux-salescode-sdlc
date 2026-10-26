// An item's test cases can live on several tabs of ONE workbook / Google Sheet.
// Each tab is parsed on its own (same rules as before), then the cases are
// merged with their tab recorded and the case key prefixed by the tab, so the
// same ID on two tabs never collides and sign-off matching stays exact.

import { MAX_TC_ROWS, parseSheetGrid, type ParsedCase, type ParseIssue, type SectionInfo, type UnmappedValue } from "./template";
import { formatRanges, inRanges, type RowRange, type ScopeInput } from "./scope";
import { MAX_TABS_PER_ITEM, TC_CATEGORY_VALUES, TC_POLARITY_VALUES, type TcCategory, type TcPolarity } from "./values";

export type TabGrid = { title: string; grid: unknown[][] };

/** A case with the tab it came from; `tcKey` is already tab-qualified. */
export type MultiCase = ParsedCase & { sheetTab: string };

export type TabSummary = {
  title: string;
  layout: "A" | "B";
  /** 1-based header row of the tab's first section (for the snapshot's frozen header). */
  headerRow: number;
  caseCount: number;
  errorCount: number;
  warningCount: number;
  /** Sections that have test cases in scope. */
  sections: SectionInfo[];
  /** The rows asked for ("12-40, 55"), or null for the whole tab. */
  rows: string | null;
  ranges: RowRange[] | null;
  /** Test cases in the whole tab, and the sections of the whole tab (to pick rows from). */
  totalCases: number;
  outline: SectionInfo[];
  /** First / last test case in scope (sheet rows and IDs). */
  firstRow: number;
  lastRow: number;
  firstId: string;
  lastId: string;
  /** Set when the first and last test case of the previous round are now on other rows: the rows that cover them today. */
  realign: { rows: string; firstRow: number; lastRow: number } | null;
};

/** Where a tab's chosen test cases were the last time (a previous round), to notice that rows have moved in the live sheet. */
export type RealignAnchor = { firstId: string; lastId: string; firstRow: number; lastRow: number };

/** A tab left out because it is not a test-case sheet (only when no tab was named). */
export type SkippedTab = { tab: string; reason: string };

export type ParseTabsOptions = {
  /** Rows per tab; a tab not in the map is read whole. */
  scope?: ScopeInput;
  /** No tab was named: tabs that are not test-case sheets are skipped (and listed) instead of failing the parse. */
  skipNonTc?: boolean;
  /** No cap on the number of cases: a sign-off reads the whole tabs of a shared sheet, which can hold many features' cases. */
  uncapped?: boolean;
  /** Previous round's first/last test case per tab (single range only), to suggest new rows if the sheet has shifted. */
  anchors?: Map<string, RealignAnchor>;
};

export type TabIssue = ParseIssue & { tab: string };

export type MultiParsed =
  | {
      ok: true;
      tabs: TabSummary[];
      cases: MultiCase[];
      issues: TabIssue[];
      unmapped: UnmappedValue[];
      categorySplit: Record<TcCategory, number>;
      polaritySplit: Record<TcPolarity, number>;
      skipped: SkippedTab[];
    }
  | { ok: false; error: string };

/** The key a case is matched by: tab, then (when the tab has sections) section / ID. */
export function caseKey(tab: string, tcKey: string): string {
  return `${tab}::${tcKey}`;
}

export function parseTabs(tabs: TabGrid[], opts: ParseTabsOptions = {}): MultiParsed {
  if (tabs.length === 0) return { ok: false, error: "Choose at least one tab." };
  if (tabs.length > MAX_TABS_PER_ITEM) return { ok: false, error: `Choose at most ${MAX_TABS_PER_ITEM} tabs for one item.` };
  const seen = new Set<string>();
  for (const t of tabs) {
    if (seen.has(t.title)) return { ok: false, error: `Tab "${t.title}" was chosen twice.` };
    seen.add(t.title);
  }

  const summaries: TabSummary[] = [];
  const cases: MultiCase[] = [];
  const issues: TabIssue[] = [];
  const skipped: SkippedTab[] = [];
  const unmapped = new Map<string, UnmappedValue>();
  const categorySplit = Object.fromEntries(TC_CATEGORY_VALUES.map((c) => [c, 0])) as Record<TcCategory, number>;
  const polaritySplit = Object.fromEntries(TC_POLARITY_VALUES.map((p) => [p, 0])) as Record<TcPolarity, number>;

  for (const t of tabs) {
    const ranges = opts.scope?.get(t.title) ?? null;
    const rowsText = ranges ? formatRanges(ranges) : null;

    // The whole tab is measured first when rows were chosen (header and section detection need the rows above the range, and
    // the key shape must not depend on the choice); a tab read whole is parsed once.
    const whole = parseSheetGrid(t.grid, ranges || opts.uncapped ? { maxCases: Number.POSITIVE_INFINITY } : {});
    if (!whole.ok) {
      if (opts.skipNonTc && !/^Too many test cases/.test(whole.error)) {
        skipped.push({ tab: t.title, reason: /header row/i.test(whole.error) ? "no Test Case ID header row" : whole.error });
        continue;
      }
      return { ok: false, error: `Tab "${t.title}": ${whole.error}` };
    }

    let parsed = whole;
    if (ranges) {
      const first = whole.cases[0].rowNumber;
      const last = whole.cases[whole.cases.length - 1].rowNumber;
      const scoped = parseSheetGrid(t.grid, {
        rowFilter: (row) => inRanges(row, ranges),
        sectionedKeys: whole.sections.length > 1,
        emptyMessage: `rows ${rowsText} contain no test cases (rows with a Test Case ID). This tab's test cases are on rows ${first}-${last}.`,
      });
      if (!scoped.ok) return { ok: false, error: `Tab "${t.title}": ${scoped.error}` };
      parsed = scoped;
    }

    // Rows move when someone inserts rows in the live sheet; the IDs do not. If the previous round's first and last test
    // case are on other rows now, offer the rows that cover them.
    let realign: TabSummary["realign"] = null;
    const anchor = opts.anchors?.get(t.title);
    if (anchor) {
      const nearest = (id: string, near: number) =>
        whole.cases.filter((c) => c.tcId === id).sort((a, b) => Math.abs(a.rowNumber - near) - Math.abs(b.rowNumber - near))[0]?.rowNumber;
      const f = nearest(anchor.firstId, anchor.firstRow);
      const l = nearest(anchor.lastId, anchor.lastRow);
      if (f !== undefined && l !== undefined && f <= l && (f !== anchor.firstRow || l !== anchor.lastRow)) {
        const now = ranges ? formatRanges(ranges) : null;
        if (now !== `${f}-${l}`) realign = { rows: `${f}-${l}`, firstRow: f, lastRow: l };
      }
    }

    const errors = parsed.issues.filter((i) => i.severity === "error");
    const firstCase = parsed.cases[0];
    const lastCase = parsed.cases[parsed.cases.length - 1];
    summaries.push({
      title: t.title,
      layout: parsed.layout,
      headerRow: parsed.headerRow,
      caseCount: parsed.cases.length,
      errorCount: errors.length,
      warningCount: parsed.issues.length - errors.length,
      sections: parsed.sections,
      rows: rowsText,
      ranges,
      totalCases: whole.cases.length,
      outline: whole.sections,
      firstRow: firstCase.rowNumber,
      lastRow: lastCase.rowNumber,
      firstId: firstCase.tcId,
      lastId: lastCase.tcId,
      realign,
    });
    for (const i of parsed.issues) issues.push({ ...i, tab: t.title });
    for (const c of parsed.cases) cases.push({ ...c, sheetTab: t.title, tcKey: caseKey(t.title, c.tcKey) });
    for (const u of parsed.unmapped) {
      const key = `${u.field}\u0000${u.value}`;
      const prev = unmapped.get(key);
      unmapped.set(key, prev ? { ...prev, count: prev.count + u.count } : { ...u });
    }
    for (const c of TC_CATEGORY_VALUES) categorySplit[c] += parsed.categorySplit[c] ?? 0;
    for (const p of TC_POLARITY_VALUES) polaritySplit[p] += parsed.polaritySplit[p] ?? 0;
  }

  if (summaries.length === 0) {
    return { ok: false, error: `None of the ${tabs.length} tab${tabs.length === 1 ? "" : "s"} holds test cases (a header row with "Test Case ID"): ${skipped.map((s) => s.tab).join(", ")}. Tick the tab that does.` };
  }
  if (!opts.uncapped && cases.length > MAX_TC_ROWS) {
    return { ok: false, error: `That is ${cases.length} test cases across the chosen tabs; the limit is ${MAX_TC_ROWS} per item. Choose the rows that belong to this item.` };
  }
  return { ok: true, tabs: summaries, cases, issues, unmapped: [...unmapped.values()], categorySplit, polaritySplit, skipped };
}
