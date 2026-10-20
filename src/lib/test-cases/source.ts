// Reads a TC source (a Google Sheet link or an uploaded xlsx) into a cell grid
// for the chosen tab. Used by both the preview (inspect) and the commit, which
// re-reads from scratch: the client's preview is never trusted.

import { readTab, listTabs } from "@/lib/google/sheets";
import { parseSheetUrl, sheetUrlFor } from "./sheet-url";
import type { TabGrid } from "./multi-tab";
import { chooseTab, pickTabs } from "./tab-select";
import { MAX_XLSX_BYTES, loadWorkbook, looksLikeXlsx, xlsxTabGrid, xlsxTabs } from "./xlsx";
import type { TcSource } from "./values";

export class SourceError extends Error {
  constructor(
    public code: "invalid_link" | "invalid_file" | "too_large" | "tab_not_found",
    message: string,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

export type SourceTabInfo = { title: string; hidden: boolean; suggested: boolean; /** Used by the item's latest round. */ previous: boolean };

export type SourceRead = {
  source: TcSource;
  sheetUrl: string | null;
  spreadsheetId: string | null;
  sheetTitle: string | null;
  tabs: SourceTabInfo[];
  /** The tabs that were read (explicit choice, else the previous round's, else the suggested one). */
  selectedTabs: string[];
  /** Previously used tabs that no longer exist in this source. */
  missingPrevious: string[];
  /** Values of each selected tab; null while no tab is chosen. */
  grids: TabGrid[] | null;
};

export type SourceInput =
  | { source: "google_sheet"; userId: string; sheetUrl: string; tabs?: string[] | null; previousTabs?: string[]; jiraKey: string }
  | { source: "xlsx"; file: Buffer; tabs?: string[] | null; previousTabs?: string[]; jiraKey: string };

function tabList(
  tabs: { title: string; hidden: boolean; sheetId?: number }[],
  previous: string[],
  suggested: string | null,
): SourceTabInfo[] {
  return tabs.map((t) => ({ title: t.title, hidden: t.hidden, suggested: t.title === suggested, previous: previous.includes(t.title) }));
}

export async function readSource(input: SourceInput): Promise<SourceRead> {
  const previous = input.previousTabs ?? [];

  if (input.source === "google_sheet") {
    const parsed = parseSheetUrl(input.sheetUrl);
    if (!parsed) {
      throw new SourceError("invalid_link", "That is not a Google Sheets link (https://docs.google.com/spreadsheets/d/...).");
    }
    const { title, tabs } = await listTabs(input.userId, parsed.spreadsheetId);
    const picked = pickTabs({ tabs, requested: input.tabs, previous, gid: parsed.gid, jiraKey: input.jiraKey });
    if (!picked.ok) throw new SourceError("tab_not_found", `Tab "${picked.missing}" was not found in that sheet.`);
    const suggested = chooseTab({ tabs, gid: parsed.gid, jiraKey: input.jiraKey });
    const grids =
      picked.selected.length > 0
        ? await Promise.all(picked.selected.map(async (t) => ({ title: t, grid: await readTab(input.userId, parsed.spreadsheetId, t) })))
        : null;
    return {
      source: "google_sheet",
      sheetUrl: sheetUrlFor(parsed.spreadsheetId, parsed.gid),
      spreadsheetId: parsed.spreadsheetId,
      sheetTitle: title,
      tabs: tabList(tabs, previous, suggested),
      selectedTabs: picked.selected,
      missingPrevious: picked.missingPrevious,
      grids,
    };
  }

  if (input.file.length > MAX_XLSX_BYTES) {
    throw new SourceError("too_large", "That file is larger than 4 MB. Share it as a Google Sheet link instead.");
  }
  if (!looksLikeXlsx(input.file)) {
    throw new SourceError("invalid_file", "That file is not an .xlsx workbook.");
  }
  let wb;
  try {
    wb = await loadWorkbook(input.file);
  } catch {
    throw new SourceError("invalid_file", "That .xlsx file could not be read. Re-save it as .xlsx and try again.");
  }
  const tabs = xlsxTabs(wb);
  const picked = pickTabs({ tabs, requested: input.tabs, previous, jiraKey: input.jiraKey });
  if (!picked.ok) throw new SourceError("tab_not_found", `Tab "${picked.missing}" was not found in that file.`);
  const suggested = chooseTab({ tabs, jiraKey: input.jiraKey });
  return {
    source: "xlsx",
    sheetUrl: null,
    spreadsheetId: null,
    sheetTitle: null,
    tabs: tabList(tabs, previous, suggested),
    selectedTabs: picked.selected,
    missingPrevious: picked.missingPrevious,
    grids: picked.selected.length > 0 ? picked.selected.map((t) => ({ title: t, grid: xlsxTabGrid(wb, t) })) : null,
  };
}
