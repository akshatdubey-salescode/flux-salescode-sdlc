// Turns a parse into what is stored: the scope the round records, and the grids that go into the snapshot and the
// content fingerprint. Pure.

import type { MultiParsed, TabGrid } from "./multi-tab";
import { type RoundScope, type ScopeEntry } from "./scope";

type Parsed = Extract<MultiParsed, { ok: true }>;

/** The scope entry for each reviewed tab, plus whether the tabs were defaulted and which were skipped. */
export function buildRoundScope(parsed: Parsed, args: { defaulted: boolean; gids: Map<string, number | null> }): RoundScope {
  const tabs: ScopeEntry[] = parsed.tabs.map((t) => ({
    tab: t.title,
    rows: t.rows,
    ranges: t.ranges,
    gid: args.gids.get(t.title) ?? null,
    totalInTab: t.totalCases,
    inScope: t.caseCount,
    firstId: t.firstId,
    lastId: t.lastId,
    firstRow: t.firstRow,
    lastRow: t.lastRow,
  }));
  return { defaulted: args.defaulted, skipped: parsed.skipped, tabs };
}

/**
 * The grids to snapshot and fingerprint: only the reviewed tabs, and in a tab with chosen rows everything outside them is
 * blanked, so other features' rows are neither stored nor re-exposed and edits to them do not count as a change. Row numbers
 * are kept (blank rows stay), so a downloaded snapshot that is uploaded again still matches the stored ranges. The header
 * and title rows of the sections that have cases in scope are kept so the snapshot is still readable.
 */
export function scopedGrids(grids: TabGrid[], parsed: Parsed): TabGrid[] {
  const byTitle = new Map(grids.map((g) => [g.title, g]));
  const out: TabGrid[] = [];
  for (const tab of parsed.tabs) {
    const source = byTitle.get(tab.title);
    if (!source) continue;
    if (!tab.ranges) {
      out.push(source);
      continue;
    }
    const keep = new Set<number>();
    for (const [s, e] of tab.ranges) for (let r = s; r <= Math.min(e, source.grid.length); r++) keep.add(r);
    const usedSections = new Set(tab.sections.map((s) => s.no));
    for (const sec of tab.outline) {
      if (!usedSections.has(sec.no)) continue;
      keep.add(sec.headerRow);
      if (sec.titleRow !== null) keep.add(sec.titleRow);
    }
    out.push({ title: tab.title, grid: source.grid.map((row, i) => (keep.has(i + 1) ? row : [])) });
  }
  return out;
}
