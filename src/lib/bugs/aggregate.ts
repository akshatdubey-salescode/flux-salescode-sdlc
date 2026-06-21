/**
 * Pure aggregation + classification helpers for the Developer-wise Bug Board.
 *
 * Kept framework-free so the (filter → aggregate → RAG) pipeline is unit-test
 * friendly and the client component stays declarative. All inputs are the small
 * pre-aggregated owner×project cells from /api/bugs — never raw issues — so
 * every function here is O(cells) with cells in the low thousands at most.
 */

import type { BugCell, BugProject } from "@/app/api/bugs/route";

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

export type TeamStats = {
  /** Real developers only (excludes the Unassigned bucket). */
  numOwners: number;
  /** Sum of every shown bug, including the Unassigned bucket (the % denominator). */
  grandTotal: number;
  /** Per-developer averages (Unassigned excluded from the denominator). */
  avg: Counts;
};

const ZERO: Counts = {
  total: 0, p1: 0, p2: 0, p3: 0, p4: 0, open: 0,
  open1: 0, open2: 0, open3: 0, open4: 0,
  cfTotal: 0, cf1: 0, cf2: 0, cf3: 0, cf4: 0,
};

function addInto(acc: Counts, c: BugCell | Counts): void {
  acc.total += c.total;
  acc.p1 += c.p1; acc.p2 += c.p2; acc.p3 += c.p3; acc.p4 += c.p4;
  acc.open += c.open;
  acc.open1 += c.open1; acc.open2 += c.open2; acc.open3 += c.open3; acc.open4 += c.open4;
  acc.cfTotal += c.cfTotal;
  acc.cf1 += c.cf1; acc.cf2 += c.cf2; acc.cf3 += c.cf3; acc.cf4 += c.cf4;
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

  for (const c of cells) {
    if (filterOn && !selectedProjectIds.has(c.projectId)) continue;

    const key = c.ownerKey ?? UNASSIGNED_KEY;
    let row = byOwner.get(key);
    if (!row) {
      row = {
        ...ZERO,
        key,
        name: c.ownerName ?? c.ownerEmail ?? "Unassigned",
        email: c.ownerEmail,
        account: c.ownerAccount,
        isUnassigned: c.ownerKey == null,
        projects: [],
      };
      byOwner.set(key, row);
    }
    // Carry the first non-null display name / account we encounter.
    if (row.name === "Unassigned" && c.ownerName) row.name = c.ownerName;
    if (!row.account && c.ownerAccount) row.account = c.ownerAccount;

    addInto(row, c);
    row.projects.push({
      projectId: c.projectId,
      projectName: c.projectName,
      total: c.total, p1: c.p1, p2: c.p2, p3: c.p3, p4: c.p4, open: c.open,
      open1: c.open1, open2: c.open2, open3: c.open3, open4: c.open4,
      cfTotal: c.cfTotal, cf1: c.cf1, cf2: c.cf2, cf3: c.cf3, cf4: c.cf4,
    });
  }

  for (const row of byOwner.values()) {
    row.projects.sort((a, b) => b.total - a.total);
  }
  return [...byOwner.values()];
}

/** Team benchmark: averages over real developers; grand total over everyone. */
export function computeTeamStats(rows: OwnerRow[]): TeamStats {
  const sum: Counts = { ...ZERO };
  let numOwners = 0;
  let grandTotal = 0;

  for (const r of rows) {
    grandTotal += r.total;
    if (r.isUnassigned) continue;
    numOwners++;
    addInto(sum, r);
  }

  const div = (n: number) => (numOwners > 0 ? n / numOwners : 0);
  return {
    numOwners,
    grandTotal,
    avg: {
      total: div(sum.total),
      p1: div(sum.p1), p2: div(sum.p2), p3: div(sum.p3), p4: div(sum.p4),
      open: div(sum.open),
      open1: div(sum.open1), open2: div(sum.open2), open3: div(sum.open3), open4: div(sum.open4),
      cfTotal: div(sum.cfTotal),
      cf1: div(sum.cf1), cf2: div(sum.cf2), cf3: div(sum.cf3), cf4: div(sum.cf4),
    },
  };
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
  };
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
): string {
  const parts = [`project = "${project.jiraProjectKey}"`, `issuetype = Bug`];

  if (account && project.ownerFieldNumIds.length > 0) {
    const ors = project.ownerFieldNumIds.map((id) => `cf[${id}] = "${account}"`);
    parts.push(`(${ors.join(" OR ")})`);
  }
  if (priority) parts.push(`priority = "${priority}"`);
  if (from)     parts.push(`created >= "${from}"`);
  if (to)       parts.push(`created <= "${to}"`);

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
