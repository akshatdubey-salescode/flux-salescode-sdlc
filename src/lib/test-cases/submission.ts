// What the validate (inspect) and commit steps share about which tabs and rows are reviewed: checking the rows asked for
// against the tabs that were read. Pure, so both routes behave the same.

import type { SourceRead } from "./source";
import { parseScopeField, type ScopeInput } from "./scope";
import { MAX_TABS_PER_ITEM } from "./values";

export type ScopeCheck =
  | { ok: true; scope: ScopeInput; rows: Map<string, string> }
  | { ok: false; status: number; error: string; code: string };

export function checkScope(read: Pick<SourceRead, "selectedTabs" | "defaulted" | "tooManyTabs" | "grids">, field: FormDataEntryValue | null): ScopeCheck {
  const parsed = parseScopeField(field);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error, code: "bad_rows" };

  if (read.tooManyTabs !== null) {
    return {
      ok: false,
      status: 400,
      code: "too_many_tabs",
      error: `No tab was named and this source has ${read.tooManyTabs} tabs; one item can review at most ${MAX_TABS_PER_ITEM}. Tick the tabs that belong to this item.`,
    };
  }
  if (!read.grids || read.selectedTabs.length === 0) {
    return { ok: false, status: 400, code: "no_tabs", error: "This source has no visible tab to review." };
  }
  if (parsed.scope.size > 0) {
    if (read.defaulted) {
      return { ok: false, status: 400, code: "rows_need_tabs", error: "Rows apply to ticked tabs. Tick the tab first, then give its rows." };
    }
    const stray = [...parsed.scope.keys()].find((tab) => !read.selectedTabs.includes(tab));
    if (stray !== undefined) return { ok: false, status: 400, code: "rows_for_unticked_tab", error: `Rows were given for tab "${stray}", which is not ticked.` };
  }
  return { ok: true, scope: parsed.scope, rows: parsed.rows };
}

/** The amber notice shown on validate when no tab was named (null otherwise). */
export function defaultedNotice(read: Pick<SourceRead, "defaulted" | "selectedTabs">, skipped: { tab: string }[], jiraKey: string): string | null {
  if (!read.defaulted) return null;
  const reviewed = read.selectedTabs.filter((t) => !skipped.some((s) => s.tab === t));
  return `No tab was named, so all ${read.selectedTabs.length} tabs of this source are reviewed (${reviewed.join(", ")}${skipped.length ? `; skipped, not test-case sheets: ${skipped.map((s) => s.tab).join(", ")}` : ""}). Tick the tabs that belong to ${jiraKey} to narrow it.`;
}
