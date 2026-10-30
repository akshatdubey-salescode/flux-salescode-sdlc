// When the second of dev / tester signs off, the saved sign-off sheet also carries the first one's results. The sheet a
// person uploads usually has only their own status column filled; the other role's recorded results are written into
// the other role's status column (added at the end when the sheet has none), so the saved file reads as one sheet with
// both. Cells the uploader already filled with a real result are never touched, and nothing is written for a role
// that has not signed off. Recorded results and counts are not affected: this only shapes the saved copy.

import type { MultiParsed, TabGrid } from "./multi-tab";
import { normalizeResult } from "./normalize";
import type { RoundCaseRef } from "./signoff";
import type { SignoffRole } from "./state";
import { fieldForHeader, cellText } from "./template";
import type { TcResult } from "./values";

type Parsed = Extract<MultiParsed, { ok: true }>;

const LABEL: Record<Exclude<TcResult, "not_run">, string> = { pass: "Passed", fail: "Failed", blocked: "Blocked" };

export function mergeOtherRoleStatuses(args: {
  /** The role signing off now; the OTHER role's results are the ones written in. */
  role: SignoffRole;
  parsed: Parsed;
  grids: TabGrid[];
  refs: RoundCaseRef[];
  /** The other role's latest recorded results by case id; empty when it has not signed off. */
  other: ReadonlyMap<string, TcResult>;
}): { grids: TabGrid[]; filled: number } {
  const { role, parsed, refs, other } = args;
  if (other.size === 0) return { grids: args.grids, filled: 0 };

  const otherField = role === "dev" ? "testerStatus" : "devStatus";
  const newHeader = role === "dev" ? "TESTER STATUS" : "DEV STATUS";
  const caseIdByKey = new Map(refs.map((r) => [r.tcKey, r.id]));
  const grids: TabGrid[] = args.grids.map((g) => ({ title: g.title, grid: g.grid.map((row) => (Array.isArray(row) ? [...row] : row)) }));
  // Where each header row's status columns are, and the column added for it when it has none.
  const added = new Map<string, number>();
  let filled = 0;

  for (const c of parsed.cases) {
    const caseId = caseIdByKey.get(c.tcKey);
    const result = caseId ? other.get(caseId) : undefined;
    if (!result || result === "not_run") continue;
    const grid = grids.find((g) => g.title === c.sheetTab)?.grid;
    const section = parsed.tabs.find((t) => t.title === c.sheetTab)?.sections.find((s) => s.no === c.sectionNo);
    if (!grid || !section) continue;

    const headerRow = (grid[section.headerRow - 1] ?? []) as unknown[];
    const row = (grid[c.rowNumber - 1] ??= []) as unknown[];
    const columns = headerRow.map((h, i) => (fieldForHeader(cellText(h)) === otherField ? i : -1)).filter((i) => i >= 0);

    // The first of the other role's columns whose cell here is empty or still "not run"; else a column added at the end.
    let target = columns.find((i) => {
      const v = cellText(row[i]);
      return v === "" || (normalizeResult(v).matched && normalizeResult(v).value === "not_run");
    });
    if (target === undefined) {
      if (columns.length > 0) continue; // every one of its columns already holds a real result
      const key = `${c.sheetTab}\u0000${section.no}`;
      let col = added.get(key);
      if (col === undefined) {
        col = headerRow.length;
        added.set(key, col);
        (grid[section.headerRow - 1] as unknown[])[col] = newHeader;
      }
      target = col;
    }
    row[target] = LABEL[result];
    filled++;
  }
  return { grids, filled };
}
