/**
 * Which PRs a deployment record covers. A per-PR record covers its own `repo#pr` (the parser also
 * lists it as the single cover); a UNION record (`marker.scope === "union"`, "union of 2 merged
 * PRs") covers every PR in `facts.covers`. Pure helpers shared by the record loader, readiness
 * and the service.
 */
import { createHash } from "node:crypto";
import type { Cover, ParsedRecord } from "./record";
import { normalizeRepo } from "./record";

/** One PR a record covers, as the record wrote it (repo normalised). */
export type CoverRef = Pick<Cover, "repo" | "pr" | "sha" | "branch" | "note" | "state">;

export const isUnion = (r: Pick<ParsedRecord, "marker">): boolean => r.marker.scope === "union";

/** The PRs the record covers (repo as the parser normalised it; callers reconcile aliases). Deduplicated, in written order. */
export function coversOf(r: ParsedRecord): CoverRef[] {
  const out: CoverRef[] = [];
  const seen = new Set<string>();
  const add = (repo: string | null | undefined, pr: number | null | undefined, more: Partial<CoverRef> = {}) => {
    if (!repo || pr === null || pr === undefined) return;
    const k = `${normalizeRepo(repo)}#${pr}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ ...more, repo: normalizeRepo(repo), pr });
  };
  if (!isUnion(r)) add(r.marker.repo, r.marker.pr);
  for (const c of r.facts.covers ?? []) {
    add(c.repo, c.pr, { ...(c.sha ? { sha: c.sha } : {}), ...(c.branch ? { branch: c.branch } : {}), ...(c.note ? { note: c.note } : {}), ...(c.state ? { state: c.state } : {}) });
  }
  return out;
}

/** Short stable identity of a union record's covers-set (for in-memory de-duplication). */
export function coversHash(r: ParsedRecord): string {
  const keys = coversOf(r).map((c) => `${c.repo}#${c.pr}`).sort();
  return createHash("sha1").update(keys.length ? keys.join(",") : `text:${r.marker.target ?? ""}`).digest("hex").slice(0, 12);
}

/** Key under which a record is kept while paging: `repo#pr`, or `union:<ticket>:<covers hash>`; null = cannot be keyed. */
export function recordIdentity(r: ParsedRecord): string | null {
  if (isUnion(r)) return `union:${(r.marker.key ?? "").toUpperCase()}:${coversHash(r)}`;
  return r.marker.repo && r.marker.pr !== null ? `${normalizeRepo(r.marker.repo)}#${r.marker.pr}` : null;
}

/** The head SHA a record says it reviewed for one of its PRs: a union record writes it on the PR line, a per-PR record in its text. */
export function reviewedHead(r: ParsedRecord, c: CoverRef): string | null {
  return (isUnion(r) ? c.sha : r.facts.headReviewed) ?? null;
}

/** PRs (repo name as written, number) with a reviewed head SHA across the records: what the optional stale-head check asks GitHub about. */
export function headTargets(records: readonly ParsedRecord[]): Array<{ repo: string; pr: number }> {
  const out = new Map<string, { repo: string; pr: number }>();
  for (const r of records) {
    for (const c of coversOf(r)) {
      if (reviewedHead(r, c)) out.set(`${c.repo}#${c.pr}`, { repo: c.repo, pr: c.pr });
    }
  }
  return [...out.values()];
}
