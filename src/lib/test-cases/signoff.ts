// Turns a submitted sign-off sheet into per-case results for the round that was
// approved. Cases are matched by their unique key (section + ID), never by row
// position, so reordering or inserting rows does not shift results.

import type { ParsedCase } from "./template";
import type { SignoffRole } from "./state";
import type { TcResult } from "./values";

export type RoundCaseRef = { id: string; tcKey: string; tcCode: string };

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
};

export function matchSignoff(roundCases: RoundCaseRef[], parsed: ParsedCase[], role: SignoffRole): SignoffMatch {
  const sheet = new Map(parsed.map((c) => [c.tcKey, c]));
  const roundKeys = new Set(roundCases.map((c) => c.tcKey));

  const counts: Record<TcResult, number> = { pass: 0, fail: 0, blocked: 0, not_run: 0 };
  const results: SignoffMatch["results"] = [];
  const missing: string[] = [];

  for (const rc of roundCases) {
    const row = sheet.get(rc.tcKey);
    if (!row) {
      missing.push(rc.tcCode);
      results.push({ caseId: rc.id, result: "not_run", remark: "" });
      counts.not_run++;
      continue;
    }
    const result = role === "dev" ? row.devResult : row.testerResult;
    const remark = role === "dev" ? row.devRemarks : row.testerRemarks;
    results.push({ caseId: rc.id, result, remark });
    counts[result]++;
  }

  const unmatched = parsed.filter((c) => !roundKeys.has(c.tcKey)).map((c) => c.tcId);
  const meta = parsed.find((c) => c.testerMeta)?.testerMeta ?? "";
  return { results, unmatched, missing, counts, meta };
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
