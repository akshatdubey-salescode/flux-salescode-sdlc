// Turns a submitted sign-off sheet into per-case results for the round that was
// approved. Cases are matched by their unique key (section + ID), never by row
// position, so reordering or inserting rows does not shift results.

import type { ParsedCase } from "./template";
import { entryFor, inRanges, type RoundScope } from "./scope";
import type { SignoffRole } from "./state";
import type { TcResult } from "./values";

export type RoundCaseRef = { id: string; tcKey: string; tcCode: string; /** The row it had when the round was submitted. */ rowNo?: number };

/** A parsed case, with its tab when it comes from a multi-tab parse. */
export type SheetCase = ParsedCase & { sheetTab?: string };

export type SignoffMatch = {
  /** One entry per case of the approved round (cases missing from the sheet are not_run). */
  results: { caseId: string; result: TcResult; remark: string }[];
  /** Sheet cases whose key is not in the approved round (new or renamed IDs). */
  unmatched: string[];
  /** Approved-round cases that do not appear in the sheet. */
  missing: string[];
  counts: Record<TcResult, number>;
  /** Tester name / date / app version, from the first case that has it. */
  meta: string;
  /** Round cases found on a different row than when the round was submitted (rows were inserted or moved); matched by ID. */
  moved: number;
};

/**
 * Matches the live sheet to the approved round by key. A shared sheet holds other features' test cases too, so the sheet is
 * read whole but only the round's own cases are looked up; sheet cases are reported as `unmatched` only when they sit in the
 * rows the round reviewed (a test case added there), never for other features' rows. If a key occurs more than once, the
 * occurrence on the row the round stored wins, then the first one inside the round's rows.
 */
export function matchSignoff(roundCases: RoundCaseRef[], parsed: SheetCase[], role: SignoffRole, scope?: RoundScope | null): SignoffMatch {
  const byKey = new Map<string, SheetCase[]>();
  for (const c of parsed) byKey.set(c.tcKey, [...(byKey.get(c.tcKey) ?? []), c]);
  const roundKeys = new Set(roundCases.map((c) => c.tcKey));
  const inRoundRows = (c: SheetCase) => {
    const ranges = c.sheetTab ? entryFor(scope, c.sheetTab)?.ranges : null;
    return inRanges(c.rowNumber, ranges);
  };

  const counts: Record<TcResult, number> = { pass: 0, fail: 0, blocked: 0, not_run: 0 };
  const results: SignoffMatch["results"] = [];
  const missing: string[] = [];
  const matched: SheetCase[] = [];
  let moved = 0;

  for (const rc of roundCases) {
    const candidates = byKey.get(rc.tcKey) ?? [];
    const row = candidates.find((c) => c.rowNumber === rc.rowNo) ?? candidates.find(inRoundRows) ?? candidates[0];
    if (!row) {
      missing.push(rc.tcCode);
      results.push({ caseId: rc.id, result: "not_run", remark: "" });
      counts.not_run++;
      continue;
    }
    if (rc.rowNo !== undefined && row.rowNumber !== rc.rowNo) moved++;
    matched.push(row);
    const result = role === "dev" ? row.devResult : row.testerResult;
    const remark = role === "dev" ? row.devRemarks : row.testerRemarks;
    results.push({ caseId: rc.id, result, remark });
    counts[result]++;
  }

  const unmatched = parsed.filter((c) => !roundKeys.has(c.tcKey) && inRoundRows(c)).map((c) => c.tcId);
  const meta = matched.find((c) => c.testerMeta)?.testerMeta ?? "";
  return { results, unmatched, missing, counts, meta, moved };
}

/** A sign-off with nothing marked would silently record "nothing tested". */
export function signoffProblem(match: SignoffMatch, roundCaseCount: number): string | null {
  if (roundCaseCount > 0 && match.missing.length === roundCaseCount) {
    return "None of the test cases in this sheet match the approved round (IDs or sections differ). Use the approved sheet.";
  }
  const marked = match.counts.pass + match.counts.fail + match.counts.blocked;
  if (marked === 0) {
    return "No statuses are filled in. Mark each test case Passed / Failed / Blocked in your column and submit again.";
  }
  return null;
}
