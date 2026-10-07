/**
 * Pure aggregation + classification helpers for the Developer-wise Bug Board.
 *
 * Kept framework-free so the (filter → aggregate → RAG) pipeline is unit-test
 * friendly and the client component stays declarative. All inputs are the small
 * pre-aggregated owner×project cells from /api/bugs — never raw issues — so
 * every function here is O(cells) with cells in the low thousands at most.
 */

import type { BugCell, BugProject } from "@/app/api/bugs/route";
import { ENV_UNSET, MISSING_ISSUE_OWNER } from "@/lib/bug-summary";

export const PRIORITIES = ["p1", "p2", "p3", "p4"] as const;
export type PriorityKey = (typeof PRIORITIES)[number];

/** Sentinel owner key for bugs with no populated owner field. */
export const UNASSIGNED_KEY = "__unassigned__";

export type Counts = {
  total: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  open: number;
  open1: number;
  open2: number;
  open3: number;
  open4: number;
  cfTotal: number;
  cf1: number;
  cf2: number;
  cf3: number;
  cf4: number;
  rcaMissingTotal: number;
  rcaMissing1: number;
  rcaMissing2: number;
  rcaMissing3: number;
  rcaMissing4: number;
};

export type ProjectBreakdown = Counts & {
  projectId: string;
  projectName: string;
};

export type OwnerRow = Counts & {
  /** UNASSIGNED_KEY for the no-owner bucket, else email/accountId. */
  key: string;
  name: string;
  email: string | null;
  account: string | null;
  isUnassigned: boolean;
  projects: ProjectBreakdown[];
};

/** One developer's slice of a single project (the transpose of ProjectBreakdown). */
export type OwnerBreakdown = Counts & {
  key: string;
  name: string;
  email: string | null;
  account: string | null;
  isUnassigned: boolean;
};

/** One row per project for the By Project board; `name` is the project name so rows sort like OwnerRows. */
export type ProjectRow = Counts & {
  /** Same as projectId — the stable React/rank key. */
  key: string;
  projectId: string;
  name: string;
  owners: OwnerBreakdown[];
};

export type TeamStats = {
  /** Real developers only (excludes the Unassigned bucket). */
  numOwners: number;
  /** Sum of every shown bug, including the Unassigned bucket (the % denominator). */
  grandTotal: number;
  /** Per-developer averages (Unassigned excluded from the denominator). */
  avg: Counts;
};

export type ProjectStats = {
  numProjects: number;
  /** Sum of every shown bug across the shown projects (the % denominator). */
  grandTotal: number;
  /** Per-project averages. */
  avg: Counts;
};

const ZERO: Counts = {
  total: 0, p1: 0, p2: 0, p3: 0, p4: 0, open: 0,
  open1: 0, open2: 0, open3: 0, open4: 0,
  cfTotal: 0, cf1: 0, cf2: 0, cf3: 0, cf4: 0,
  rcaMissingTotal: 0, rcaMissing1: 0, rcaMissing2: 0, rcaMissing3: 0, rcaMissing4: 0,
};

function addInto(acc: Counts, c: BugCell | Counts): void {
  acc.total += c.total;
  acc.p1 += c.p1; acc.p2 += c.p2; acc.p3 += c.p3; acc.p4 += c.p4;
  acc.open += c.open;
  acc.open1 += c.open1; acc.open2 += c.open2; acc.open3 += c.open3; acc.open4 += c.open4;
  acc.cfTotal += c.cfTotal;
  acc.cf1 += c.cf1; acc.cf2 += c.cf2; acc.cf3 += c.cf3; acc.cf4 += c.cf4;
  acc.rcaMissingTotal += c.rcaMissingTotal;
  acc.rcaMissing1 += c.rcaMissing1; acc.rcaMissing2 += c.rcaMissing2;
  acc.rcaMissing3 += c.rcaMissing3; acc.rcaMissing4 += c.rcaMissing4;
}

/**
 * Collapse owner×project cells into one row per owner, honouring the project
 * filter (empty set = all projects). Each row keeps its per-project breakdown
 * for the inline drill-down.
 */
export function buildOwnerRows(
  cells: BugCell[],
  selectedProjectIds: Set<string>,
): OwnerRow[] {
  const filterOn = selectedProjectIds.size > 0;
  const byOwner = new Map<string, OwnerRow>();
  // Cells are keyed by owner×project×environment, so one project can appear in
  // several cells for the same owner — merge them by projectId.
  const projByOwner = new Map<string, Map<string, ProjectBreakdown>>();

  for (const c of cells) {
    if (filterOn && !selectedProjectIds.has(c.projectId)) continue;

    const key = c.ownerKey ?? UNASSIGNED_KEY;
    let row = byOwner.get(key);
    if (!row) {
      row = {
        ...ZERO,
        key,
        name: c.ownerName ?? c.ownerEmail ?? MISSING_ISSUE_OWNER,
        email: c.ownerEmail,
        account: c.ownerAccount,
        isUnassigned: c.ownerKey == null,
        projects: [],
      };
      byOwner.set(key, row);
      projByOwner.set(key, new Map());
    }
    // Carry the first non-null display name / account we encounter.
    if (row.name === MISSING_ISSUE_OWNER && c.ownerName) row.name = c.ownerName;
    if (!row.account && c.ownerAccount) row.account = c.ownerAccount;

    addInto(row, c);

    const projMap = projByOwner.get(key)!;
    const proj = projMap.get(c.projectId);
    if (proj) {
      addInto(proj, c);
    } else {
      projMap.set(c.projectId, {
        projectId: c.projectId,
        projectName: c.projectName,
        total: c.total, p1: c.p1, p2: c.p2, p3: c.p3, p4: c.p4, open: c.open,
        open1: c.open1, open2: c.open2, open3: c.open3, open4: c.open4,
        cfTotal: c.cfTotal, cf1: c.cf1, cf2: c.cf2, cf3: c.cf3, cf4: c.cf4,
        rcaMissingTotal: c.rcaMissingTotal, rcaMissing1: c.rcaMissing1,
        rcaMissing2: c.rcaMissing2, rcaMissing3: c.rcaMissing3, rcaMissing4: c.rcaMissing4,
      });
    }
  }

  for (const [key, row] of byOwner) {
    row.projects = [...projByOwner.get(key)!.values()].sort((a, b) => b.total - a.total);
  }
  return [...byOwner.values()];
}

/**
 * Collapse owner×project×env cells into one row per project, the transpose of
 * buildOwnerRows. Both filters narrow what is COUNTED: an empty project set means
 * all projects, and a non-empty developer set drops every other developer's
 * cells (including the no-owner bucket) so project totals match what the
 * By Developer view shows for the same selection.
 */
export function buildProjectRows(
  cells: BugCell[],
  selectedProjectIds: Set<string>,
  selectedOwnerKeys: Set<string>,
): ProjectRow[] {
  const projectFilterOn = selectedProjectIds.size > 0;
  const ownerFilterOn = selectedOwnerKeys.size > 0;
  const byProject = new Map<string, ProjectRow>();
  const ownersByProject = new Map<string, Map<string, OwnerBreakdown>>();

  for (const c of cells) {
    if (projectFilterOn && !selectedProjectIds.has(c.projectId)) continue;
    if (ownerFilterOn && (c.ownerKey == null || !selectedOwnerKeys.has(c.ownerKey))) continue;

    let row = byProject.get(c.projectId);
    if (!row) {
      row = { ...ZERO, key: c.projectId, projectId: c.projectId, name: c.projectName, owners: [] };
      byProject.set(c.projectId, row);
      ownersByProject.set(c.projectId, new Map());
    }
    addInto(row, c);

    const ownerKey = c.ownerKey ?? UNASSIGNED_KEY;
    const ownerMap = ownersByProject.get(c.projectId)!;
    let owner = ownerMap.get(ownerKey);
    if (!owner) {
      owner = {
        ...ZERO,
        key: ownerKey,
        name: c.ownerName ?? c.ownerEmail ?? MISSING_ISSUE_OWNER,
        email: c.ownerEmail,
        account: c.ownerAccount,
        isUnassigned: c.ownerKey == null,
      };
      ownerMap.set(ownerKey, owner);
    }
    if (owner.name === MISSING_ISSUE_OWNER && c.ownerName) owner.name = c.ownerName;
    if (!owner.account && c.ownerAccount) owner.account = c.ownerAccount;
    addInto(owner, c);
  }

  for (const [projectId, row] of byProject) {
    row.owners = [...ownersByProject.get(projectId)!.values()].sort((a, b) => {
      if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
      return b.total - a.total;
    });
  }
  return [...byProject.values()];
}

/**
 * Distinct environment labels present across the cells, in a stable preferred
 * order (Prod, Demo, UAT first; the rest alphabetical; "no env" last). Drives
 * the Env filter chips. Mirrors the ordering used by the per-project boards.
 */
export function deriveEnvironments(cells: BugCell[]): string[] {
  const present = new Set(cells.map((c) => c.environment));
  const preferred = ["Prod", "Demo", "UAT"];
  const ordered = preferred.filter((e) => present.has(e));
  const rest = [...present]
    .filter((e) => !preferred.includes(e) && e !== ENV_UNSET)
    .sort();
  if (present.has(ENV_UNSET)) rest.push(ENV_UNSET);
  return [...ordered, ...rest];
}

/** Field-wise sum of every Counts in the list (the grand-total row). */
export function sumCounts(rows: Counts[]): Counts {
  const sum: Counts = { ...ZERO };
  for (const r of rows) addInto(sum, r);
  return sum;
}

/** Collapse the per-project developer slices into one slice per developer (the Total row's Developer Breakdown). */
export function mergeOwnerBreakdowns(rows: ProjectRow[]): OwnerBreakdown[] {
  const byOwner = new Map<string, OwnerBreakdown>();
  for (const row of rows) {
    for (const o of row.owners) {
      const ex = byOwner.get(o.key);
      if (ex) addInto(ex, o);
      else byOwner.set(o.key, { ...o });
    }
  }
  return [...byOwner.values()].sort((a, b) => {
    if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
    return b.total - a.total;
  });
}

/** Per-row average of every Counts field (zero when there are no rows). */
function averageCounts(rows: Counts[]): Counts {
  const sum: Counts = { ...ZERO };
  for (const r of rows) addInto(sum, r);
  const avg: Counts = { ...ZERO };
  for (const k of Object.keys(ZERO) as (keyof Counts)[]) {
    avg[k] = rows.length > 0 ? sum[k] / rows.length : 0;
  }
  return avg;
}

/** Team benchmark: averages over real developers; grand total over everyone. */
export function computeTeamStats(rows: OwnerRow[]): TeamStats {
  let grandTotal = 0;
  const developers: OwnerRow[] = [];

  for (const r of rows) {
    grandTotal += r.total;
    if (!r.isUnassigned) developers.push(r);
  }

  return { numOwners: developers.length, grandTotal, avg: averageCounts(developers) };
}

/** Project benchmark for the By Project board: averages over every shown project. */
export function computeProjectStats(rows: ProjectRow[]): ProjectStats {
  let grandTotal = 0;
  for (const r of rows) grandTotal += r.total;
  return { numProjects: rows.length, grandTotal, avg: averageCounts(rows) };
}

// ---------------------------------------------------------------------------
// Priority filtering
// ---------------------------------------------------------------------------

/**
 * Derive counts as if only the selected priorities exist. When all four are
 * selected this is a no-op identity. Use this in the client to adjust totals
 * and open counts without re-fetching.
 */
export function effectiveCounts(counts: Counts, sel: Set<PriorityKey>): Counts {
  if (sel.size === 0 || sel.size === 4) return counts;
  const p1 = sel.has("p1") ? counts.p1 : 0;
  const p2 = sel.has("p2") ? counts.p2 : 0;
  const p3 = sel.has("p3") ? counts.p3 : 0;
  const p4 = sel.has("p4") ? counts.p4 : 0;
  const open1 = sel.has("p1") ? counts.open1 : 0;
  const open2 = sel.has("p2") ? counts.open2 : 0;
  const open3 = sel.has("p3") ? counts.open3 : 0;
  const open4 = sel.has("p4") ? counts.open4 : 0;
  return {
    p1, p2, p3, p4,
    total: p1 + p2 + p3 + p4,
    open: open1 + open2 + open3 + open4,
    open1, open2, open3, open4,
    cf1: sel.has("p1") ? counts.cf1 : 0,
    cf2: sel.has("p2") ? counts.cf2 : 0,
    cf3: sel.has("p3") ? counts.cf3 : 0,
    cf4: sel.has("p4") ? counts.cf4 : 0,
    cfTotal:
      (sel.has("p1") ? counts.cf1 : 0) +
      (sel.has("p2") ? counts.cf2 : 0) +
      (sel.has("p3") ? counts.cf3 : 0) +
      (sel.has("p4") ? counts.cf4 : 0),
    rcaMissing1: sel.has("p1") ? counts.rcaMissing1 : 0,
    rcaMissing2: sel.has("p2") ? counts.rcaMissing2 : 0,
    rcaMissing3: sel.has("p3") ? counts.rcaMissing3 : 0,
    rcaMissing4: sel.has("p4") ? counts.rcaMissing4 : 0,
    rcaMissingTotal:
      (sel.has("p1") ? counts.rcaMissing1 : 0) +
      (sel.has("p2") ? counts.rcaMissing2 : 0) +
      (sel.has("p3") ? counts.rcaMissing3 : 0) +
      (sel.has("p4") ? counts.rcaMissing4 : 0),
  };
}

/**
 * The board's Priority + "Customer-found only" filters applied to one row's
 * counts. Shared by the By Developer and By Project views so both always agree.
 * Customer-found only re-points the priority columns at the customer-found
 * counts and zeroes Open (it has no per-source split).
 */
export function applyBoardFilters(c: Counts, sel: Set<PriorityKey>, cfOnly: boolean): Counts {
  const afterPriority = effectiveCounts(c, sel);
  if (!cfOnly) return afterPriority;
  return {
    ...afterPriority,
    total: afterPriority.cfTotal,
    p1: afterPriority.cf1, p2: afterPriority.cf2,
    p3: afterPriority.cf3, p4: afterPriority.cf4,
    open: 0, open1: 0, open2: 0, open3: 0, open4: 0,
  };
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type SortKey = "name" | "total" | "p1" | "p2" | "p3" | "p4" | "open" | "open1" | "open2" | "open3" | "open4";

// Tie-break cascade for any column-wise sort, in this fixed priority order
// (each descending) — whichever key is the primary sort itself is skipped
// (comparing it to itself can never break a tie), then Name (ascending) is
// the always-unique final tiebreaker.
const TIE_BREAK_ORDER: SortKey[] = ["total", "p1", "p2", "p3", "p4", "open"];

/** Comparator for board rows (developers or projects) by the active column, with the deterministic tie-break cascade. */
export function compareCountRows<T extends Counts & { name: string }>(
  a: T,
  b: T,
  sortBy: SortKey,
  sortDir: "asc" | "desc",
): number {
  const dir = sortDir === "asc" ? 1 : -1;
  const primary = (() => {
    if (sortBy === "name") return dir * a.name.localeCompare(b.name);
    const av = a[sortBy] as number;
    const bv = b[sortBy] as number;
    // A "—" (0) in the sorted column has nothing to rank by — it sinks to the
    // bottom regardless of asc/desc. Direction only decides order between two
    // real values.
    if (!av !== !bv) return av ? -1 : 1;
    return dir * (av - bv);
  })();
  if (primary !== 0) return primary;

  for (const key of TIE_BREAK_ORDER) {
    if (key === sortBy) continue;
    const diff = (b[key] as number) - (a[key] as number);
    if (diff !== 0) return diff;
  }
  return a.name.localeCompare(b.name);
}

// ---------------------------------------------------------------------------
// RAG (red / amber / green) classification
// ---------------------------------------------------------------------------

export type Rag = "red" | "amber" | "green" | "neutral";

/** ±15% band around the team average counts as "near equal" (amber). */
const NEAR_BAND = 0.15;

/**
 * Classify a count against the team average. More bugs than average is "bad"
 * (red); near the average is amber; comfortably below is green. A zero/empty
 * benchmark yields neutral so we never divide by zero or flag noise.
 */
export function rag(value: number, avg: number): Rag {
  if (avg <= 0) return value > 0 ? "amber" : "neutral";
  const ratio = value / avg;
  if (ratio > 1 + NEAR_BAND) return "red";
  if (ratio >= 1 - NEAR_BAND) return "amber";
  return "green";
}

/**
 * Inline badge classes per RAG state. Applied to the number/value span inside
 * the cell — gives a small rounded pill rather than colouring the whole cell.
 * Neutral means no decoration at all (plain foreground text).
 */
export const RAG_BADGE: Record<Rag, string> = {
  red:     "rounded px-1.5 py-0.5 font-semibold bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400",
  amber:   "rounded px-1.5 py-0.5 font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400",
  green:   "rounded px-1.5 py-0.5 font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400",
  neutral: "",
};

// ---------------------------------------------------------------------------
// Jira deep-linking
// ---------------------------------------------------------------------------

/**
 * Build a Jira issue-navigator URL for one owner's bugs in one project.
 * ORs the project's candidate custom owner-field IDs against the accountId so
 * the link is accurate regardless of which field is populated on each issue.
 *
 * @param priority optional "P1".."P4" to further scope the link.
 */
export function jiraOwnerBugLink(
  project: Pick<BugProject, "jiraBaseUrl" | "jiraProjectKey" | "ownerFieldNumIds">,
  account: string | null,
  priority?: string,
  from?: string,
  to?: string,
  cfOnly?: boolean,
  freshdeskFieldId?: number | null,
): string {
  const parts = [`project = "${project.jiraProjectKey}"`, `issuetype = Bug`];

  if (account && project.ownerFieldNumIds.length > 0) {
    const ors = project.ownerFieldNumIds.map((id) => `cf[${id}] = "${account}"`);
    parts.push(`(${ors.join(" OR ")})`);
  }
  if (priority)                    parts.push(`priority = "${priority}"`);
  if (from)                        parts.push(`created >= "${from}"`);
  if (to)                          parts.push(`created <= "${to}"`);
  if (cfOnly && freshdeskFieldId)  parts.push(`cf[${freshdeskFieldId}] is not EMPTY`);

  const jql = parts.join(" AND ") + " ORDER BY priority ASC";
  const base = project.jiraBaseUrl.replace(/\/$/, "");
  return `${base}/issues/?jql=${encodeURIComponent(jql)}`;
}

/** Owner-filter options derived from the full (unfiltered) cell universe. */
export function deriveOwnerOptions(
  cells: BugCell[],
): { value: string; label: string }[] {
  const map = new Map<string, string>();
  for (const c of cells) {
    if (c.ownerKey == null) continue; // Unassigned isn't a filterable owner
    if (!map.has(c.ownerKey) || (c.ownerName && map.get(c.ownerKey) === c.ownerKey)) {
      map.set(c.ownerKey, c.ownerName ?? c.ownerEmail ?? c.ownerKey);
    }
  }
  return [...map.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
