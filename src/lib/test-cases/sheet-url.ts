// Only Google Sheets links are accepted, and only the spreadsheet ID is ever
// used — the URL itself is never fetched, so a pasted link cannot make the
// server call an arbitrary host.

export type ParsedSheetUrl = { spreadsheetId: string; gid: number | null };

const ID_RE = /^[A-Za-z0-9_-]{20,}$/;

export function parseSheetUrl(input: string): ParsedSheetUrl | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") return null;
  const m = /^\/spreadsheets\/d\/([^/]+)/.exec(url.pathname);
  if (!m || !ID_RE.test(m[1])) return null;

  // The tab is in the fragment (#gid=123) or, less often, the query (?gid=123).
  const fromHash = /(?:^|[#&])gid=(\d+)/.exec(url.hash);
  const fromQuery = url.searchParams.get("gid");
  const raw = fromHash?.[1] ?? (fromQuery && /^\d+$/.test(fromQuery) ? fromQuery : null);
  return { spreadsheetId: m[1], gid: raw === null ? null : Number(raw) };
}

/** Canonical link to the spreadsheet (and tab), rebuilt from the parsed parts. */
export function sheetUrlFor(spreadsheetId: string, gid: number | null): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit${gid === null ? "" : `#gid=${gid}`}`;
}
