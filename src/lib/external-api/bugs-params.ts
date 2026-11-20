// Query-param parsing for GET /api/v1/projects/{id}/bugs. Pure (no DB), so it
// is unit-tested alongside the shared filters in bug-summary.ts. Unlike the
// internal route, bad input is a 400 with a reason — an external caller
// should learn its filter was wrong, not get silently unfiltered data.

import {
  BUG_SORT_KEYS,
  applyBugScopeFilters,
  applyBugDetailFilters,
  sortBugs,
  type BugPriorityBucket,
  type BugRow,
  type BugSortKey,
} from "@/lib/bug-summary";

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

/**
 * Applies a parsed query to loaded rows: scope filters, detail filters,
 * status/priority, sort, then the page. Shared by the per-project and the
 * cross-project bug endpoints so both answer the same way.
 */
export function applyBugsQuery(
  rows: BugRow[],
  query: BugsQuery
): { total: number; page: BugRow[] } {
  const scoped = applyBugScopeFilters(rows, { env: query.env, excludeInvalid: !query.includeInvalid });
  const detailed = applyBugDetailFilters(scoped, { owner: query.owner, q: query.q }).filter(
    (b) =>
      (query.status === "all" || (query.status === "open" ? b.isOpen : !b.isOpen)) &&
      (!query.priority || query.priority.includes(b.priorityBucket))
  );
  const sorted = sortBugs(detailed, query.sort, query.dir);
  return { total: sorted.length, page: sorted.slice(query.offset, query.offset + query.limit) };
}

export type ProjectRef = { id: string; key: string; jiraBaseUrl: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a `projects=` list (Jira keys and/or Flux project ids, comma
 * separated, case-insensitive) against the known projects. A key shared by
 * projects on two Jira sites is ambiguous and must be given by id instead.
 */
export function resolveProjectRefs(
  raw: string,
  projects: ProjectRef[]
): { ok: true; ids: string[] } | { ok: false; message: string } {
  const parts = [...new Set(raw.split(",").map((p) => p.trim()).filter(Boolean))];
  if (parts.length === 0) return { ok: false, message: "'projects' is empty." };

  const ids: string[] = [];
  const unknown: string[] = [];
  const ambiguous: string[] = [];
  for (const part of parts) {
    const matches = UUID_RE.test(part)
      ? projects.filter((p) => p.id === part.toLowerCase())
      : projects.filter((p) => p.key.toLowerCase() === part.toLowerCase());
    if (matches.length === 0) unknown.push(part);
    else if (matches.length > 1) ambiguous.push(part);
    else if (!ids.includes(matches[0].id)) ids.push(matches[0].id);
  }
  if (unknown.length) {
    return { ok: false, message: `Unknown project(s): ${unknown.join(", ")}. List valid ones with GET /api/v1/projects.` };
  }
  if (ambiguous.length) {
    return {
      ok: false,
      message: `Project key(s) ${ambiguous.join(", ")} exist on more than one Jira site; use the project id instead (see GET /api/v1/projects).`,
    };
  }
  return { ok: true, ids };
}
