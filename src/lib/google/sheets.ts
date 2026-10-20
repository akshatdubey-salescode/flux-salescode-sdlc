// Reads Google Sheets as the signed-in user, using the per-user Google
// connection Flux already stores (see lib/google/oauth.ts) plus the on-demand
// "sheets" scope. Reads only: list tabs, read one tab's values.

import { getValidAccessToken } from "./oauth";

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

async function accessToken(userId: string): Promise<string> {
  const token = await getValidAccessToken(userId);
  if (!token) throw new SheetsError("not_connected", SHEETS_ERROR_MESSAGES.not_connected);
  return token;
}

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

async function sheetsGet(userId: string, url: string): Promise<unknown> {
  const token = await accessToken(userId);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new SheetsError("failed", SHEETS_ERROR_MESSAGES.failed);
  }
  if (!res.ok) throw classifySheetsFailure(res.status, await res.text().catch(() => ""));
  return res.json();
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
