// Turns an inspect / commit / sign-off form submission into a source to read,
// enforcing the item's source lock on the way: a locked Google Sheet needs no
// link from the user, and a different link or a switch of source is refused
// before anything is read.

import { checkLock, type ItemLock } from "./lock";
import { parseSheetUrl } from "./sheet-url";
import type { SourceInput } from "./source";
import { MAX_XLSX_BYTES } from "./xlsx";

export type SourceRequestFailure = { ok: false; status: number; error: string; code?: string };

/** Reads the `tabs` field: a JSON array of tab titles, or absent (= not chosen yet). */
export function parseTabsField(raw: FormDataEntryValue | null): { ok: true; tabs: string[] | null } | SourceRequestFailure {
  if (raw === null || raw === "") return { ok: true, tabs: null };
  try {
    const v = JSON.parse(String(raw));
    if (Array.isArray(v) && v.every((t) => typeof t === "string")) return { ok: true, tabs: v };
  } catch {
    // falls through
  }
  return { ok: false, status: 400, error: "Invalid tab selection." };
}

export async function resolveSourceInput(args: {
  form: FormData;
  userId: string;
  jiraKey: string;
  lock: ItemLock | null;
  /** Sign-off reads exactly the latest round's tabs; submissions read what the user ticked. */
  fixedTabs?: string[];
}): Promise<{ ok: true; input: SourceInput } | SourceRequestFailure> {
  const { form, lock } = args;

  const tabsField = parseTabsField(form.get("tabs"));
  if (!tabsField.ok) return tabsField;
  const tabs = args.fixedTabs ?? tabsField.tabs;
  const previousTabs = lock?.tabs ?? [];

  const file = form.get("file");
  const typedUrl = typeof form.get("sheetUrl") === "string" ? (form.get("sheetUrl") as string).trim() : "";

  if (file instanceof File && file.size > 0) {
    const verdict = checkLock(lock, { source: "xlsx", spreadsheetId: null });
    if (!verdict.ok) return { ok: false, status: 409, error: verdict.reason, code: "source_locked" };
    if (file.size > MAX_XLSX_BYTES) {
      return { ok: false, status: 413, error: "That file is larger than 4 MB. Share it as a Google Sheet link instead.", code: "too_large" };
    }
    return { ok: true, input: { source: "xlsx", file: Buffer.from(await file.arrayBuffer()), tabs, previousTabs, jiraKey: args.jiraKey } };
  }

  // A locked sheet is used as is; the user never has to paste the link again.
  const url = lock?.source === "google_sheet" && lock.sheetUrl ? (typedUrl || lock.sheetUrl) : typedUrl;
  if (!url) {
    const hint =
      lock?.source === "xlsx"
        ? "Attach the revised .xlsx workbook."
        : "Provide a Google Sheet link or an .xlsx file.";
    return { ok: false, status: 400, error: hint };
  }
  const parsed = parseSheetUrl(url);
  const verdict = checkLock(lock, { source: "google_sheet", spreadsheetId: parsed?.spreadsheetId ?? null });
  if (!verdict.ok) return { ok: false, status: 409, error: verdict.reason, code: "source_locked" };
  return { ok: true, input: { source: "google_sheet", userId: args.userId, sheetUrl: url, tabs, previousTabs, jiraKey: args.jiraKey } };
}
