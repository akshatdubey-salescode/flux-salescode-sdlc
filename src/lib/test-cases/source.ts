// Reads a TC source (a Google Sheet link or an uploaded xlsx) into a cell grid
// for the chosen tab. Used by both the preview (inspect) and the commit, which
// re-reads from scratch: the client's preview is never trusted.

import { readTab, listTabs } from "@/lib/google/sheets";
import { parseSheetUrl, sheetUrlFor } from "./sheet-url";
import { chooseTab } from "./tab-select";
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

export type SourceRead = {
  source: TcSource;
  sheetUrl: string | null;
  spreadsheetId: string | null;
  sheetTitle: string | null;
  tabs: { title: string; hidden: boolean; suggested: boolean }[];
  selectedTab: string | null;
  /** Values of the selected tab, null while the user still has to pick a tab. */
  grid: unknown[][] | null;
};

export type SourceInput =
  | { source: "google_sheet"; userId: string; sheetUrl: string; tab?: string | null; jiraKey: string }
  | { source: "xlsx"; file: Buffer; tab?: string | null; jiraKey: string };

export async function readSource(input: SourceInput): Promise<SourceRead> {
  if (input.source === "google_sheet") {
    const parsed = parseSheetUrl(input.sheetUrl);
    if (!parsed) {
      throw new SourceError("invalid_link", "That is not a Google Sheets link (https://docs.google.com/spreadsheets/d/...).");
    }
    const { title, tabs } = await listTabs(input.userId, parsed.spreadsheetId);
    if (input.tab && !tabs.some((t) => t.title === input.tab && !t.hidden)) {
      throw new SourceError("tab_not_found", `Tab "${input.tab}" was not found in that sheet.`);
    }
    const selectedTab = chooseTab({ tabs, requested: input.tab, gid: parsed.gid, jiraKey: input.jiraKey });
    const suggested = chooseTab({ tabs, gid: parsed.gid, jiraKey: input.jiraKey });
    return {
      source: "google_sheet",
      sheetUrl: sheetUrlFor(parsed.spreadsheetId, parsed.gid),
      spreadsheetId: parsed.spreadsheetId,
      sheetTitle: title,
      tabs: tabs.map((t) => ({ title: t.title, hidden: t.hidden, suggested: t.title === suggested })),
      selectedTab,
      grid: selectedTab ? await readTab(input.userId, parsed.spreadsheetId, selectedTab) : null,
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
  if (input.tab && !tabs.some((t) => t.title === input.tab && !t.hidden)) {
    throw new SourceError("tab_not_found", `Tab "${input.tab}" was not found in that file.`);
  }
  const selectedTab = chooseTab({ tabs, requested: input.tab, jiraKey: input.jiraKey });
  const suggested = chooseTab({ tabs, jiraKey: input.jiraKey });
  return {
    source: "xlsx",
    sheetUrl: null,
    spreadsheetId: null,
    sheetTitle: null,
    tabs: tabs.map((t) => ({ title: t.title, hidden: t.hidden, suggested: t.title === suggested })),
    selectedTab,
    grid: selectedTab ? xlsxTabGrid(wb, selectedTab) : null,
  };
}
