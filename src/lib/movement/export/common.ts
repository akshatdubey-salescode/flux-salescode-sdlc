/** Shared by the Excel, text and print-page writers. */

/** Rows per sheet / checklist items per page (header excluded); the rest is replaced by one "N more rows omitted" note. */
export const MAX_EXPORT_ROWS = 20_000;

// The rest of the app shows IST in en-IN (see components/delivery-tracker/movement/view-model.ts); the exports match it
// and always say IST, so a printout or a sheet read elsewhere is not ambiguous.
const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });

/** "19 Nov 2026, 05:15 pm IST"; "" for null/empty, the input itself when it is not a date. */
export function fmtTs(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${IST.format(d)} IST`;
}
