// Reads a TC source (a Google Sheet link or an uploaded xlsx) into a cell grid
// for the chosen tab. Used by both the preview (inspect) and the commit, which
// re-reads from scratch: the client's preview is never trusted.

import { readTab, listTabs } from "@/lib/google/sheets";
import { parseSheetUrl, sheetUrlFor } from "./sheet-url";
import { sha256Hex } from "./content-hash";
import type { TabGrid } from "./multi-tab";
import { pickTabs } from "./tab-select";
import { tabMatchesJiraKey } from "./template";
import { MAX_XLSX_BYTES, loadWorkbook, looksLikeXlsx, xlsxTabGrid, xlsxTabs } from "./xlsx";
import { MAX_TABS_PER_ITEM, type TcSource } from "./values";

export class SourceError extends Error {
  constructor(
    public code: "invalid_link" | "invalid_file" | "too_large" | "tab_not_found",
    message: string,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

export type SourceTabInfo = {
  title: string;
  hidden: boolean;
  suggested: boolean;
  /** Used by the item's latest round. */
  previous: boolean;
  /** Google Sheets tab id (for links into the live sheet); null for Excel. */
  gid: number | null;
};

export type SourceRead = {
  source: TcSource;
  sheetUrl: string | null;
  spreadsheetId: string | null;
  sheetTitle: string | null;
  tabs: SourceTabInfo[];
  /** The tabs that were read (explicit choice, else the previous round's, else the link's tab, else all visible tabs). */
  selectedTabs: string[];
  /** No tab was named, so every visible tab was taken: the caller must warn (and non-test-case tabs are skipped when parsing). */
  defaulted: boolean;
  /** No tab was named and there are more visible tabs than one item may review: nothing was read; the person must tick tabs. */
  tooManyTabs: number | null;
  /** Previously used tabs that no longer exist in this source. */
  missingPrevious: string[];
  /** Values of each selected tab; null while no tab is chosen. */
  grids: TabGrid[] | null;
  /** SHA-256 of the uploaded .xlsx (null for a Google Sheet): recognises the same workbook on other items. */
  sourceHash: string | null;
};

export type SourceInput =
  | { source: "google_sheet"; userId: string; sheetUrl: string; tabs?: string[] | null; previousTabs?: string[]; jiraKey: string }
  | { source: "xlsx"; file: Buffer; tabs?: string[] | null; previousTabs?: string[]; jiraKey: string };

/** The one visible tab whose name contains the Jira key (the "name matches" badge). The #gid or a lone tab is not a name match. */
function tabNamedAfter(tabs: { title: string; hidden: boolean }[], jiraKey: string): string | null {
  const named = tabs.filter((t) => !t.hidden && tabMatchesJiraKey(t.title, jiraKey));
  return named.length === 1 ? named[0].title : null;
}

function tabList(
  tabs: { title: string; hidden: boolean; sheetId?: number }[],
  previous: string[],
  suggested: string | null,
): SourceTabInfo[] {
  return tabs.map((t) => ({ title: t.title, hidden: t.hidden, suggested: t.title === suggested, previous: previous.includes(t.title), gid: t.sheetId ?? null }));
}

/** Which tab is missing, which tabs the source has, and which tabs were being looked for (sign-off reads the approved round's tabs). */
function tabNotFoundMessage(missing: string, tabs: { title: string; hidden: boolean }[], wanted: string[] | null | undefined, what: "sheet" | "file"): string {
  const have = tabs.filter((t) => !t.hidden).map((t) => `"${t.title}"`);
  const shown = have.length > 12 ? `${have.slice(0, 12).join(", ")} and ${have.length - 12} more` : have.join(", ");
  const looking = wanted && wanted.length > 0 ? ` The tabs being read are ${wanted.map((t) => `"${t}"`).join(", ")}.` : "";
  return `Tab "${missing}" was not found in that ${what}.${looking} This ${what} has the visible tab${have.length === 1 ? "" : "s"}: ${shown || "(none)"}. Tab names must match exactly, including spaces and capital letters.`;
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
    if (!picked.ok) throw new SourceError("tab_not_found", tabNotFoundMessage(picked.missing, tabs, input.tabs, "sheet"));
    const suggested = tabNamedAfter(tabs, input.jiraKey);
    const tooMany = picked.defaulted && picked.selected.length > MAX_TABS_PER_ITEM;
    const toRead = tooMany ? [] : picked.selected;
    const grids =
      toRead.length > 0
        ? await Promise.all(toRead.map(async (t) => ({ title: t, grid: await readTab(input.userId, parsed.spreadsheetId, t) })))
        : null;
    return {
      source: "google_sheet",
      sheetUrl: sheetUrlFor(parsed.spreadsheetId, parsed.gid),
      spreadsheetId: parsed.spreadsheetId,
      sheetTitle: title,
      tabs: tabList(tabs, previous, suggested),
      selectedTabs: toRead,
      defaulted: picked.defaulted && !tooMany,
      tooManyTabs: tooMany ? picked.selected.length : null,
      missingPrevious: picked.missingPrevious,
      grids,
      sourceHash: null,
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
  if (!picked.ok) throw new SourceError("tab_not_found", tabNotFoundMessage(picked.missing, tabs, input.tabs, "file"));
  const suggested = tabNamedAfter(tabs, input.jiraKey);
  const tooMany = picked.defaulted && picked.selected.length > MAX_TABS_PER_ITEM;
  const toRead = tooMany ? [] : picked.selected;
  return {
    source: "xlsx",
    sheetUrl: null,
    spreadsheetId: null,
    sheetTitle: null,
    tabs: tabList(tabs, previous, suggested),
    selectedTabs: toRead,
    defaulted: picked.defaulted && !tooMany,
    tooManyTabs: tooMany ? picked.selected.length : null,
    missingPrevious: picked.missingPrevious,
    grids: toRead.length > 0 ? toRead.map((t) => ({ title: t, grid: xlsxTabGrid(wb, t) })) : null,
    sourceHash: sha256Hex(input.file),
  };
}
