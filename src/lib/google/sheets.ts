// Reads Google Sheets. Flux's own shared Google account (see shared-reader.ts) is used first, so anything shared with
// the company's Google domain, or with that account, opens without anyone connecting their own Google. If that account
// can't open a sheet, the person's own Google connection (lib/google/oauth.ts, on-demand "sheets" scope) is tried as a
// fallback. Reads only: list tabs, read one tab's values.

import { getValidAccessToken } from "./oauth";
import { getSharedAccessToken, markSharedReaderOk } from "./shared-reader";

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const TIMEOUT_MS = 20_000;

export type SheetTab = { sheetId: number; title: string; hidden: boolean; index: number };

export type SheetsErrorCode =
  | "not_connected" // no Google connection / token revoked
  | "scope_missing" // connected, but never granted Sheets access
  | "no_access" // the user cannot open this spreadsheet
  | "not_found"
  | "api_disabled" // Sheets API not enabled on the OAuth project
  | "rate_limited"
  | "failed";

export class SheetsError extends Error {
  constructor(
    public code: SheetsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SheetsError";
  }
}

export const SHEETS_ERROR_MESSAGES: Record<SheetsErrorCode, string> = {
  not_connected: "Connect your Google account to read this sheet.",
  scope_missing: "Allow Flux to read Google Sheets (one-time) to read this sheet.",
  no_access: "You don't have access to this Google Sheet. Ask the owner to share it with you.",
  not_found: "That Google Sheet could not be found. Check the link.",
  api_disabled: "The Google Sheets API is not enabled for Flux's Google project. Ask an admin.",
  rate_limited: "Google is rate limiting requests. Try again in a minute.",
  failed: "Could not read the Google Sheet. Try again.",
};

/** Maps a failed Sheets API response to a typed error. */
export function classifySheetsFailure(status: number, body: string): SheetsError {
  const lower = body.toLowerCase();
  if (status === 401) return new SheetsError("not_connected", SHEETS_ERROR_MESSAGES.not_connected);
  if (status === 403) {
    if (lower.includes("insufficient authentication scopes") || lower.includes("access_token_scope_insufficient")) {
      return new SheetsError("scope_missing", SHEETS_ERROR_MESSAGES.scope_missing);
    }
    if (lower.includes("has not been used") || lower.includes("is disabled") || lower.includes("service_disabled")) {
      return new SheetsError("api_disabled", SHEETS_ERROR_MESSAGES.api_disabled);
    }
    return new SheetsError("no_access", SHEETS_ERROR_MESSAGES.no_access);
  }
  if (status === 404) return new SheetsError("not_found", SHEETS_ERROR_MESSAGES.not_found);
  if (status === 429) return new SheetsError("rate_limited", SHEETS_ERROR_MESSAGES.rate_limited);
  return new SheetsError("failed", SHEETS_ERROR_MESSAGES.failed);
}

/** What to tell someone when Flux's shared account can't open a sheet (and they have no connection of their own). */
export function sharedNoAccessMessage(email: string): string {
  return `Flux's Google account (${email}) can't open this Google Sheet. Share the sheet with ${email}, or set its sharing to "Anyone at Salescode with the link", then try again.`;
}

async function fetchSheets(token: string, url: string): Promise<{ ok: true; data: unknown } | { ok: false; error: SheetsError }> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    return { ok: false, error: new SheetsError("failed", SHEETS_ERROR_MESSAGES.failed) };
  }
  if (!res.ok) return { ok: false, error: classifySheetsFailure(res.status, await res.text().catch(() => "")) };
  return { ok: true, data: await res.json() };
}

/** Reads through the shared account first; on "can't open it" falls back to the person's own Google connection. */
async function sheetsGet(userId: string, url: string): Promise<unknown> {
  const shared = await getSharedAccessToken();
  if (shared) {
    const first = await fetchSheets(shared.token, url);
    if (first.ok) {
      void markSharedReaderOk();
      return first.data;
    }
    // Only "this account may not see it" is worth a second try as the person; anything else (API off, rate limit,
    // network) would fail the same way.
    if (first.error.code !== "no_access" && first.error.code !== "not_found") throw first.error;
    const own = userId ? await getValidAccessToken(userId).catch(() => null) : null;
    if (own) {
      const second = await fetchSheets(own, url);
      if (second.ok) return second.data;
      if (second.error.code !== "scope_missing" && second.error.code !== "not_connected") throw second.error;
    }
    throw first.error.code === "no_access" ? new SheetsError("no_access", sharedNoAccessMessage(shared.email)) : first.error;
  }
  const token = await getValidAccessToken(userId);
  if (!token) throw new SheetsError("not_connected", SHEETS_ERROR_MESSAGES.not_connected);
  const only = await fetchSheets(token, url);
  if (!only.ok) throw only.error;
  return only.data;
}

/** Whether one spreadsheet opens with Flux's shared account alone (for the admin's "test a link"). */
export async function probeWithSharedAccount(spreadsheetId: string): Promise<{ ok: true; title: string; tabs: number } | { ok: false; code: SheetsErrorCode; message: string }> {
  const shared = await getSharedAccessToken();
  if (!shared) return { ok: false, code: "not_connected", message: "The shared Google account is not connected." };
  const fields = encodeURIComponent("properties.title,sheets.properties.sheetId");
  const r = await fetchSheets(shared.token, `${API}/${encodeURIComponent(spreadsheetId)}?fields=${fields}`);
  if (r.ok) {
    void markSharedReaderOk();
    const d = r.data as { properties?: { title?: string }; sheets?: unknown[] };
    return { ok: true, title: d.properties?.title ?? "", tabs: d.sheets?.length ?? 0 };
  }
  return { ok: false, code: r.error.code, message: r.error.code === "no_access" ? sharedNoAccessMessage(shared.email) : r.error.message };
}

/** Spreadsheet title and its tabs (hidden tabs included, flagged). */
export async function listTabs(
  userId: string,
  spreadsheetId: string,
): Promise<{ title: string; tabs: SheetTab[] }> {
  const fields = encodeURIComponent("properties.title,sheets.properties(sheetId,title,hidden,index)");
  const data = (await sheetsGet(userId, `${API}/${encodeURIComponent(spreadsheetId)}?fields=${fields}`)) as {
    properties?: { title?: string };
    sheets?: { properties?: { sheetId?: number; title?: string; hidden?: boolean; index?: number } }[];
  };
  const tabs: SheetTab[] = (data.sheets ?? []).flatMap((s) => {
    const p = s.properties;
    if (!p || p.sheetId === undefined || !p.title) return [];
    return [{ sheetId: p.sheetId, title: p.title, hidden: !!p.hidden, index: p.index ?? 0 }];
  });
  return { title: data.properties?.title ?? "", tabs };
}

/** All values of one tab as displayed in the sheet (formatted text), rows may be ragged. */
export async function readTab(userId: string, spreadsheetId: string, tabTitle: string): Promise<unknown[][]> {
  // A1 notation: a quoted tab name with embedded single quotes doubled.
  const range = `'${tabTitle.replace(/'/g, "''")}'`;
  const url =
    `${API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}` +
    `?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
  const data = (await sheetsGet(userId, url)) as { values?: unknown[][] };
  return data.values ?? [];
}
