/** Choosing the newest record per PR, and a size estimate for byte-bounded caches. */
import type { ParsedRecord } from "./types";
import { prKey } from "./util";

export interface PickOptions {
  /**
   * Group by Jira key as well (`KEY|repo#pr`). Default false: group by `repo#pr` only, which is
   * what callers want when all records come from one Jira (or from the Jiras of one PR).
   */
  perKey?: boolean;
}

function timeOf(r: ParsedRecord): number {
  for (const s of [r.comment.updated, r.comment.created, r.marker.at]) {
    if (s) {
      const t = Date.parse(s);
      if (!Number.isNaN(t)) return t;
    }
  }
  return 0;
}

function idNum(r: ParsedRecord): number {
  const n = Number(r.comment.id);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Higher = newer: marker version first, then comment updated/created time, then numeric comment
 * id, then the id as text (so the result never depends on the input order).
 */
function compare(a: ParsedRecord, b: ParsedRecord): number {
  return (
    (b.marker.version ?? 0) - (a.marker.version ?? 0) ||
    timeOf(b) - timeOf(a) ||
    idNum(b) - idNum(a) ||
    (a.comment.id < b.comment.id ? 1 : a.comment.id > b.comment.id ? -1 : 0)
  );
}

/**
 * Repo names of one PR number that are the same repo written two ways: `auth-service` and
 * `salescode-auth-service` (the longer one ends with `-<shorter>`) map to the longer name. Only
 * records that carry the SAME PR number are reconciled, which keeps two genuinely different repos
 * apart.
 */
function repoCanon(records: ParsedRecord[]): Map<string, string> {
  const byPr = new Map<number, Set<string>>();
  for (const r of records) {
    if (!r.marker.repo || r.marker.pr === null) continue;
    const set = byPr.get(r.marker.pr) ?? new Set<string>();
    set.add(r.marker.repo);
    byPr.set(r.marker.pr, set);
  }
  const canon = new Map<string, string>();
  for (const [pr, repos] of byPr) {
    for (const a of repos) {
      let best = a;
      for (const b of repos) {
        if (b.length > best.length && b.endsWith("-" + a)) best = b;
      }
      canon.set(`${pr}\u0000${a}`, best);
    }
  }
  return canon;
}

/**
 * Newest record per `repo#PR` (repo normalised, so `salescode-ai/channelkart-flutter` and
 * `channelkart-flutter` are one, and so are `auth-service#332` and `salescode-auth-service#332`).
 * Records that another record in the same group explicitly supersedes (by comment id, or by
 * version number) are dropped first; if that would remove every record (a cycle) the plain
 * ordering is used. Records without repo or PR cannot be grouped and are returned as they are,
 * newest first. The result does not depend on the input order.
 */
export function pickNewestPerPr(records: ParsedRecord[], opts: PickOptions = {}): ParsedRecord[] {
  const canon = repoCanon(records);
  const groups = new Map<string, ParsedRecord[]>();
  const loose: ParsedRecord[] = [];
  for (const r of records) {
    if (!r.marker.repo || r.marker.pr === null) {
      loose.push(r);
      continue;
    }
    const repo = canon.get(`${r.marker.pr}\u0000${r.marker.repo}`) ?? r.marker.repo;
    const k = (opts.perKey ? `${r.marker.key ?? ""}|` : "") + prKey(repo, r.marker.pr);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out: ParsedRecord[] = [];
  for (const g of groups.values()) {
    const dead = new Set<ParsedRecord>();
    for (const r of g) {
      const sup = r.marker.supersedes;
      if (!sup) continue;
      for (const o of g) {
        if (o === r) continue;
        // `supersedes` only removes records that are strictly OLDER than the one naming them:
        // an old record that names a newer one must not discard it.
        if (compare(r, o) >= 0) continue;
        if (sup.commentIds.includes(o.comment.id)) dead.add(o);
        else if (
          sup.commentIds.length === 0 &&
          o.marker.version !== null &&
          sup.versions.includes(o.marker.version) &&
          (r.marker.version ?? 0) > o.marker.version
        ) {
          dead.add(o);
        }
      }
    }
    let alive = g.filter((r) => !dead.has(r));
    if (alive.length === 0) alive = g;
    out.push([...alive].sort(compare)[0]);
  }
  loose.sort(compare);
  return [...out.sort(compare), ...loose];
}

/** Same repo, allowing the short/long spelling of one repo (`auth-service` / `salescode-auth-service`) when the PR number is equal. */
function sameRepo(a: string, b: string): boolean {
  return a === b || a.endsWith("-" + b) || b.endsWith("-" + a);
}

/**
 * Newest records of a ticket, per-PR and union kinds together. ONE review comment per Jira is the model:
 *  - For UNION records (one comment that lists every PR, `marker.scope === "union"`) of the same ticket
 *    the NEWEST one (marker version, then comment time, then id) supersedes every older union record of
 *    that ticket, whatever PRs either lists. Union records are never dropped for lacking a repo/PR.
 *  - Per-PR records (legacy, one comment per PR) are picked exactly as `pickNewestPerPr` does, EXCEPT that a
 *    per-PR record of a PR the ticket's newest union record covers is dropped: the union wins for that PR.
 * Result: the surviving per-PR picks (newest first), then the newest union record of each ticket (newest first).
 */
export function pickNewestRecords(records: ParsedRecord[], opts: PickOptions = {}): ParsedRecord[] {
  const perPr = records.filter((r) => r.marker.scope !== "union");
  const unions = records.filter((r) => r.marker.scope === "union");
  const newestUnion = new Map<string, ParsedRecord>();
  for (const u of unions) {
    const k = (u.marker.key ?? "").toUpperCase();
    const cur = newestUnion.get(k);
    if (!cur || compare(u, cur) < 0) newestUnion.set(k, u);
  }
  const picked = pickNewestPerPr(perPr, opts).filter((r) => {
    const u = newestUnion.get((r.marker.key ?? "").toUpperCase());
    if (!u) return true;
    // The newest union names the older comments it replaces: a per-PR record it names is retired even when the union's PR list does not show its PR.
    if (u.marker.supersedes?.commentIds.includes(r.comment.id) && compare(u, r) < 0) return false;
    if (!r.marker.repo || r.marker.pr === null) return true;
    return !(u.facts.covers ?? []).some((c) => c.pr === r.marker.pr && sameRepo(c.repo, r.marker.repo as string));
  });
  return [...picked, ...[...newestUnion.values()].sort(compare)];
}

const ASCII = /^[\x00-\x7f]*$/;

/**
 * Rough heap size of a parsed record in bytes: strings count one byte per ASCII character (two
 * otherwise) plus a header, objects/arrays a small overhead per member. Shared objects (the
 * unknowns held by both a section and the record) are counted once. Meant for LRU byte budgets,
 * not exact accounting.
 */
export function approxBytes(record: ParsedRecord): number {
  let total = 0;
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): void => {
    if (depth > 24 || v === null || v === undefined) return;
    switch (typeof v) {
      case "string":
        total += 24 + (ASCII.test(v) ? v.length : v.length * 2);
        return;
      case "number":
      case "boolean":
        total += 8;
        return;
      case "object": {
        const o = v as object;
        if (seen.has(o)) {
          total += 8; // just the reference
          return;
        }
        seen.add(o);
        if (Array.isArray(o)) {
          total += 16 + o.length * 8;
          for (const x of o) walk(x, depth + 1);
        } else {
          total += 32;
          for (const [k, x] of Object.entries(o as Record<string, unknown>)) {
            total += 16 + k.length;
            walk(x, depth + 1);
          }
        }
      }
    }
  };
  walk(record, 0);
  return total;
}
