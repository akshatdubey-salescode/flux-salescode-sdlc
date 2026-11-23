/**
 * Fixed date format for text that is STORED in a warning ("Could not re-check since 19 Nov, 9:51 pm IST").
 * Deliberately not Intl / locale / clock dependent: the same instant must always give the same string, so a
 * stored warning is never rewritten just because the server's locale or time zone differs.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const IST_OFFSET_MS = 330 * 60_000; // UTC+05:30, no daylight saving

/** `19 Nov, 9:51 pm IST` for an ISO timestamp (or Date); the input itself when it cannot be parsed. */
export function formatIst(input: string | Date): string {
  const t = typeof input === "string" ? Date.parse(input) : input.getTime();
  if (Number.isNaN(t)) return String(input);
  const d = new Date(t + IST_OFFSET_MS); // read with the UTC getters: they now show IST wall-clock time
  const h24 = d.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${h12}:${mm} ${h24 < 12 ? "am" : "pm"} IST`;
}

/** Plain-language sentences for the parser's warning codes (user-visible text must never show an internal code). */
const PARSE_NOTES: Readonly<Record<string, string>> = {
  json_missing: "the record has no JSON block",
  json_malformed: "the record's JSON block could not be read",
  json_disagrees: "the record text and its JSON block disagree",
  section_missing: "some sections of the record are missing",
  section_duplicate: "a section appears twice in the record",
  section_title_mismatch: "a section title does not match its number",
  header_mismatch: "the record header does not match the Jira or PR it was posted on",
  date_unparseable: "the record date could not be read",
  extractor_failed: "part of the record could not be read",
  truncated: "part of the record was cut for size",
};
export const PARSE_NOTE_DEFAULT = "the record has formatting notes";

/** One sentence for a set of parser warning codes (known codes in plain words, any other code as the default; no repeats). */
export function plainParseNotes(codes: readonly string[]): string {
  const out: string[] = [];
  for (const c of codes) {
    const s = PARSE_NOTES[c] ?? PARSE_NOTE_DEFAULT;
    if (!out.includes(s)) out.push(s);
  }
  return out.join("; ");
}
