// Query-param parsing for GET /api/v1/projects/{id}/bugs. Pure (no DB), so it
// is unit-tested alongside the shared filters in bug-summary.ts. Unlike the
// internal route, bad input is a 400 with a reason — an external caller
// should learn its filter was wrong, not get silently unfiltered data.

import { BUG_SORT_KEYS, type BugPriorityBucket, type BugSortKey } from "@/lib/bug-summary";

export const BUGS_DEFAULT_LIMIT = 1000;
export const BUGS_MAX_LIMIT = 5000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITY_BUCKETS: BugPriorityBucket[] = ["P1", "P2", "P3", "Other"];

export type BugsQuery = {
  start: string;
  end: string;
  env: string | null;
  owner: string | null;
  q: string | null;
  includeInvalid: boolean;
  status: "all" | "open" | "closed";
  priority: BugPriorityBucket[] | null;
  sort: BugSortKey;
  dir: "asc" | "desc";
  limit: number;
  offset: number;
};

function isValidDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function parseBool(v: string): boolean | null {
  const s = v.toLowerCase();
  if (["true", "1", "yes"].includes(s)) return true;
  if (["false", "0", "no"].includes(s)) return false;
  return null;
}

function parseIntParam(v: string): number | null {
  return /^\d+$/.test(v) ? Number(v) : null;
}

/**
 * @param defaults the all-time start + today, supplied by the caller so this
 * stays deterministic under test.
 */
export function parseBugsQuery(
  params: URLSearchParams,
  defaults: { start: string; end: string }
): { ok: true; query: BugsQuery } | { ok: false; message: string } {
  const get = (k: string) => {
    const v = params.get(k);
    return v === null || v.trim() === "" ? null : v.trim();
  };

  const start = get("start") ?? defaults.start;
  const end = get("end") ?? defaults.end;
  if (!isValidDate(start)) return { ok: false, message: "'start' must be a date in YYYY-MM-DD format." };
  if (!isValidDate(end)) return { ok: false, message: "'end' must be a date in YYYY-MM-DD format." };
  if (start > end) return { ok: false, message: "'start' must be on or before 'end'." };

  let includeInvalid = false;
  const rawInvalid = get("includeInvalid");
  if (rawInvalid !== null) {
    const b = parseBool(rawInvalid);
    if (b === null) return { ok: false, message: "'includeInvalid' must be true or false." };
    includeInvalid = b;
  }

  const rawStatus = (get("status") ?? "all").toLowerCase();
  if (rawStatus !== "all" && rawStatus !== "open" && rawStatus !== "closed") {
    return { ok: false, message: "'status' must be one of: all, open, closed." };
  }

  let priority: BugPriorityBucket[] | null = null;
  const rawPriority = get("priority");
  if (rawPriority !== null) {
    const parts = rawPriority.split(",").map((p) => p.trim()).filter(Boolean);
    const out: BugPriorityBucket[] = [];
    for (const p of parts) {
      const match = PRIORITY_BUCKETS.find((b) => b.toLowerCase() === p.toLowerCase());
      if (!match) return { ok: false, message: `'priority' values must be from: ${PRIORITY_BUCKETS.join(", ")}.` };
      if (!out.includes(match)) out.push(match);
    }
    priority = out.length ? out : null;
  }

  const rawSort = get("sort");
  if (rawSort !== null && !(BUG_SORT_KEYS as string[]).includes(rawSort)) {
    return { ok: false, message: `'sort' must be one of: ${BUG_SORT_KEYS.join(", ")}.` };
  }
  const sort = (rawSort ?? "priority") as BugSortKey;

  const rawDir = (get("dir") ?? "asc").toLowerCase();
  if (rawDir !== "asc" && rawDir !== "desc") return { ok: false, message: "'dir' must be asc or desc." };

  let limit = BUGS_DEFAULT_LIMIT;
  const rawLimit = get("limit");
  if (rawLimit !== null) {
    const n = parseIntParam(rawLimit);
    if (n === null || n < 1 || n > BUGS_MAX_LIMIT) {
      return { ok: false, message: `'limit' must be an integer from 1 to ${BUGS_MAX_LIMIT}.` };
    }
    limit = n;
  }

  let offset = 0;
  const rawOffset = get("offset");
  if (rawOffset !== null) {
    const n = parseIntParam(rawOffset);
    if (n === null) return { ok: false, message: "'offset' must be a non-negative integer." };
    offset = n;
  }

  return {
    ok: true,
    query: {
      start,
      end,
      env: get("env"),
      owner: get("owner"),
      q: get("q"),
      includeInvalid,
      status: rawStatus,
      priority,
      sort,
      dir: rawDir,
      limit,
      offset,
    },
  };
}
