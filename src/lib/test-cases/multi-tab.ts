// An item's test cases can live on several tabs of ONE workbook / Google Sheet.
// Each tab is parsed on its own (same rules as before), then the cases are
// merged with their tab recorded and the case key prefixed by the tab, so the
// same ID on two tabs never collides and sign-off matching stays exact.

import { MAX_TC_ROWS, parseSheetGrid, type ParsedCase, type ParseIssue, type SectionInfo, type UnmappedValue } from "./template";
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
  sections: SectionInfo[];
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
    }
  | { ok: false; error: string };

/** The key a case is matched by: tab, then (when the tab has sections) section / ID. */
export function caseKey(tab: string, tcKey: string): string {
  return `${tab}::${tcKey}`;
}

export function parseTabs(tabs: TabGrid[]): MultiParsed {
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
  const unmapped = new Map<string, UnmappedValue>();
  const categorySplit = Object.fromEntries(TC_CATEGORY_VALUES.map((c) => [c, 0])) as Record<TcCategory, number>;
  const polaritySplit = Object.fromEntries(TC_POLARITY_VALUES.map((p) => [p, 0])) as Record<TcPolarity, number>;

  for (const t of tabs) {
    const parsed = parseSheetGrid(t.grid);
    if (!parsed.ok) return { ok: false, error: `Tab "${t.title}": ${parsed.error}` };

    const errors = parsed.issues.filter((i) => i.severity === "error");
    summaries.push({
      title: t.title,
      layout: parsed.layout,
      headerRow: parsed.headerRow,
      caseCount: parsed.cases.length,
      errorCount: errors.length,
      warningCount: parsed.issues.length - errors.length,
      sections: parsed.sections,
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

  if (cases.length > MAX_TC_ROWS) {
    return { ok: false, error: `That is ${cases.length} test cases across the chosen tabs; the limit is ${MAX_TC_ROWS} per item.` };
  }
  return { ok: true, tabs: summaries, cases, issues, unmapped: [...unmapped.values()], categorySplit, polaritySplit };
}
