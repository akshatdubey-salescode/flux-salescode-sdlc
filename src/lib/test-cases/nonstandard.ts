// Values in a sheet that Flux's standard lists do not recognise (a TC type nobody mapped, a status word like "Blocked-ish"),
// found again from a committed round's raw cells. The submit preview shows them ("Values that didn't match the standard
// lists"); the AI review reports the same thing as feedback, so it reaches the author and the reviewers too.

import { fieldForHeader } from "./template";
import { normalizePriority, normalizeResult, normalizeSeverity, normalizeTypeColumns } from "./normalize";
import { TC_CATEGORY_LABELS, TC_CATEGORY_VALUES, TC_POLARITY_LABELS, TC_POLARITY_VALUES } from "./values";

export type NonstandardField = "TC type" | "Classification" | "Severity" | "Priority" | "Dev status" | "Tester status";
export type NonstandardValue = { field: NonstandardField; value: string; count: number };

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Counts of each unrecognised value, most frequent first. `rows` are the cases' raw cells (header label to text). */
export function collectNonstandard(rows: Record<string, string>[]): NonstandardValue[] {
  const found = new Map<string, NonstandardValue>();
  const note = (field: NonstandardField, value: string) => {
    const v = clean(value);
    if (!v) return;
    const key = `${field}\u0000${v.toLowerCase()}`;
    const ex = found.get(key);
    if (ex) ex.count++;
    else found.set(key, { field, value: v, count: 1 });
  };

  for (const raw of rows) {
    const cell: Partial<Record<string, string>> = {};
    for (const [label, value] of Object.entries(raw ?? {})) {
      const f = fieldForHeader(label);
      if (f && cell[f] === undefined) cell[f] = value;
    }
    for (const u of normalizeTypeColumns(cell.classification, cell.tcType).unmatched) note(u.column === "type" ? "TC type" : "Classification", u.value);
    if (!normalizeSeverity(cell.severity).matched) note("Severity", cell.severity ?? "");
    if (!normalizePriority(cell.priority).matched) note("Priority", cell.priority ?? "");
    if (!normalizeResult(cell.devStatus).matched) note("Dev status", cell.devStatus ?? "");
    if (!normalizeResult(cell.testerStatus).matched) note("Tester status", cell.testerStatus ?? "");
  }
  return [...found.values()].sort((a, b) => b.count - a.count || a.field.localeCompare(b.field) || a.value.localeCompare(b.value));
}

const TYPE_LIST = [...TC_POLARITY_VALUES.map((p) => TC_POLARITY_LABELS[p]), ...TC_CATEGORY_VALUES.filter((c) => c !== "other" && c !== "unspecified").map((c) => TC_CATEGORY_LABELS[c])].join(", ");

/** What each field accepts, in words an author can act on. */
export const STANDARD_VALUES: Record<NonstandardField, string> = {
  "TC type": TYPE_LIST,
  Classification: TYPE_LIST,
  Severity: "Critical, High, Major, Medium, Low",
  Priority: "P1, P2, P3, P4",
  "Dev status": "Passed, Failed, Blocked, Not run",
  "Tester status": "Passed, Failed, Blocked, Not run",
};

const SHOWN_VALUES = 12;

/** The text of the AI review's finding for these values; null when everything was recognised. Pure, so it is stable between runs. */
export function nonstandardMessage(values: NonstandardValue[], caseCount: number): string | null {
  if (values.length === 0) return null;
  const affected = values.reduce((n, v) => n + v.count, 0);
  const lines = values.slice(0, SHOWN_VALUES).map((v) => `${v.field}: "${v.value}" × ${v.count}`);
  const more = values.length > SHOWN_VALUES ? `; and ${values.length - SHOWN_VALUES} more` : "";
  const fields = [...new Set(values.map((v) => v.field))];
  const accepted = fields.map((f) => `${f}: ${STANDARD_VALUES[f]}`).join(" | ");
  return (
    `${affected} value${affected === 1 ? "" : "s"} across ${caseCount} test case${caseCount === 1 ? "" : "s"} do not match the standard lists, so they are kept as typed and counted as "Other" or "not run" in the results and analytics: ` +
    `${lines.join("; ")}${more}. Use a standard value, or ask for the new value to be added to the list. Accepted values: ${accepted}.`
  );
}
