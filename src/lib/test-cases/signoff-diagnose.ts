// Explains, in words the person can act on, why a sign-off sheet cannot be recorded: which column Flux looks for, which
// columns the uploaded sheet has, how many rows had a value and what the values were. Replaces a one-line "fill the status".

import { acceptedHeaders, fieldForHeader, type CanonicalField } from "./template";
import type { MultiParsed, TabGrid } from "./multi-tab";
import { normalizeResult } from "./normalize";
import { signoffProblem, type RoundCaseRef, type SignoffMatch } from "./signoff";
import type { SignoffRole } from "./state";

type Parsed = Extract<MultiParsed, { ok: true }>;

const ROLE_LABEL: Record<SignoffRole, string> = { dev: "developer", tester: "tester" };
const FIELD: Record<SignoffRole, CanonicalField> = { dev: "devStatus", tester: "testerStatus" };
const FIELD_NAME: Record<SignoffRole, string> = { dev: "Dev Status", tester: "Tester Status" };
const SHOWN = 8;

/** Spreadsheet column letters: 0 -> A, 26 -> AA. */
export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

const text = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const list = (items: string[], max = SHOWN) => (items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", "));

type TabColumns = { tab: string; headers: string[]; statusColumn: string | null; statusHeader: string | null; /** Every column of this tab that holds this role's status ("O Dev Review", "T DEV STATUS"). */ statusColumns: string[] };

/** The header cells of each tab (every section's header row) and where its status column for this role is, if anywhere. */
function readColumns(role: SignoffRole, parsed: Parsed, grids: TabGrid[]): TabColumns[] {
  const out: TabColumns[] = [];
  for (const tab of parsed.tabs) {
    const grid = grids.find((g) => g.title === tab.title)?.grid ?? [];
    const rows = [...new Set([tab.headerRow, ...tab.sections.map((s) => s.headerRow)])];
    const headers: string[] = [];
    let statusColumn: string | null = null;
    let statusHeader: string | null = null;
    const statusColumns: string[] = [];
    for (const r of rows) {
      (grid[r - 1] ?? []).forEach((cell, c) => {
        const label = text(cell);
        if (!label) return;
        const entry = `${columnLetter(c)} "${label}"`;
        if (!headers.includes(entry)) headers.push(entry);
        if (fieldForHeader(label) === FIELD[role]) {
          if (statusColumn === null) {
            statusColumn = columnLetter(c);
            statusHeader = label;
          }
          if (!statusColumns.includes(entry)) statusColumns.push(entry);
        }
      });
    }
    out.push({ tab: tab.title, headers, statusColumn, statusHeader, statusColumns });
  }
  return out;
}

/**
 * The reason a sign-off cannot be recorded, or null when it can. Same rules as signoffProblem, with the detail
 * (columns found, values read, IDs expected and found) added so the person knows what to change.
 */
export function explainSignoffProblem(args: { role: SignoffRole; match: SignoffMatch; refs: RoundCaseRef[]; parsed: Parsed; grids: TabGrid[] }): string | null {
  const { role, match, refs, parsed, grids } = args;
  if (signoffProblem(match, refs.length) === null) return null;
  const who = ROLE_LABEL[role];

  // Nothing in the sheet matches the approved round.
  if (refs.length > 0 && match.missing.length === refs.length) {
    const expected = refs.map((r) => r.tcCode);
    const found = parsed.cases.map((c) => c.tcId);
    const tabs = parsed.tabs.map((t) => `"${t.title}"`).join(", ");
    return (
      `None of the ${refs.length} test cases of the approved round were found in this sheet. Flux matches by tab name, section and Test Case ID. ` +
      `The approved round has IDs ${list(expected)}; the sheet read (tabs ${tabs}) has ${found.length} test case${found.length === 1 ? "" : "s"}` +
      `${found.length > 0 ? `: ${list(found)}` : ""}. ` +
      `Use the approved sheet (download the snapshot from the round), keep its tab names and IDs, and fill the ${FIELD_NAME[role]} column in it.`
    );
  }

  const columns = readColumns(role, parsed, grids);
  const accepted = list(acceptedHeaders(FIELD[role]).map((h) => `"${h}"`));
  const rawOf = (c: Parsed["cases"][number]) => text(role === "dev" ? c.devStatus : c.testerStatus);
  // Only the cases of the approved round count, whatever else the sheet holds.
  const roundKeys = new Set(refs.map((r) => r.tcKey));
  const mine = parsed.cases.filter((c) => roundKeys.has(c.tcKey));

  const withColumn = columns.filter((c) => c.statusColumn !== null);
  if (withColumn.length === 0) {
    const found = columns.map((c) => `${c.tab}: ${c.headers.length > 0 ? list(c.headers, 24) : "(no header cells)"}`).join(" | ");
    return (
      `No ${who} status column was found, so nothing could be read. Flux reads the ${who} result from a column headed ${accepted} ` +
      `(case and punctuation do not matter). The columns in this sheet are: ${found}. ` +
      `Add a column with one of those headings, or rename yours, then fill Passed, Failed or Blocked for each test case and upload again.`
    );
  }

  const where = withColumn.map((c) => `"${c.statusHeader}" (column ${c.statusColumn} of tab "${c.tab}")`).join(", ");
  // Several columns can hold the same status: Flux takes, per test case, the first one that has a real result.
  const several = withColumn.filter((c) => c.statusColumns.length > 1).map((c) => `tab "${c.tab}": ${c.statusColumns.join(", ")}`);
  const severalNote = several.length > 0 ? ` More than one column holds the ${who} status (${several.join("; ")}); for each test case Flux uses the first of them that has Passed, Failed or Blocked, so fill any one of them.` : "";
  const values = new Map<string, { value: string; count: number }>();
  for (const c of mine) {
    const v = rawOf(c);
    if (!v) continue;
    const key = v.toLowerCase();
    const ex = values.get(key);
    if (ex) ex.count++;
    else values.set(key, { value: v, count: 1 });
  }
  const filled = [...values.values()].reduce((n, v) => n + v.count, 0);
  const missingTabs = columns.filter((c) => c.statusColumn === null).map((c) => c.tab);
  const noColumnNote = missingTabs.length > 0 ? ` Tab${missingTabs.length === 1 ? "" : "s"} ${list(missingTabs.map((t) => `"${t}"`))} ${missingTabs.length === 1 ? "has" : "have"} no ${who} status column.` : "";

  if (filled === 0) {
    return (
      `The ${who} status column was found (${where}) but it is empty for all ${mine.length} test case${mine.length === 1 ? "" : "s"} of the approved round. ` +
      `Fill Passed, Failed or Blocked in that column for each test case and upload again.${noColumnNote}${severalNote}`
    );
  }

  const shown = [...values.values()].sort((a, b) => b.count - a.count).map((v) => `"${v.value}" × ${v.count}`);
  const recognised = [...values.values()].filter((v) => normalizeResult(v.value).matched);
  const unknown = [...values.values()].filter((v) => !normalizeResult(v.value).matched).map((v) => `"${v.value}" × ${v.count}`);
  if (recognised.length === 0) {
    return (
      `${filled} cell${filled === 1 ? "" : "s"} in ${where} have a value, but none is a status Flux understands: ${list(shown)}. ` +
      `Use Passed, Failed, Blocked or Not run (Done counts as Passed; anything starting with Blocked counts as Blocked).${noColumnNote}${severalNote}`
    );
  }
  return (
    `${filled} cell${filled === 1 ? "" : "s"} in ${where} have a value, but every one reads as "Not run": ${list(shown)}. ` +
    `Mark each test case Passed, Failed or Blocked; Pending, Not Executed and In progress do not count as results.` +
    `${unknown.length > 0 ? ` Not understood: ${list(unknown)}.` : ""}${noColumnNote}${severalNote}`
  );
}
