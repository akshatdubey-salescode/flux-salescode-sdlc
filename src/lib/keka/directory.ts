// Shared read model over the synced Keka employee directory.
//
// This is the one place every surface gets org context (department, reporting
// manager + full chain, job title, tenure, active/relieved). The Lines of Code
// view pioneered the join (keka_employees aggregated per user, manager chain
// walked from reportsTo); this generalises it so any surface can enrich its
// people by email in a couple of lines instead of re-writing the SQL.
//
// Coverage note: keka_employees holds ONLY active employees (the sync prunes
// relieved/exited rows), so "present in the directory" == "currently employed".
// Most people in Jira/GitHub data have no Keka row at all (no work-email match,
// or no longer employed) — callers must treat a miss as "no org context", never
// as an error. Use LEFT-join semantics (lookups return undefined on a miss).

import { cacheLife, cacheTag } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { KEKA_DIRECTORY_TAG } from "./cache-tags";

export type KekaDirectoryEntry = {
  kekaEmployeeId: string;
  // Lowercased work email — the join key to Jira assignees / app users.
  email: string | null;
  displayName: string | null;
  jobTitle: string | null;
  department: string | null;
  managerKekaId: string | null;
  managerName: string | null;
  managerEmail: string | null;
  // Linked app user id (lowercased email) or null when this employee has no
  // Flux account. Lets surfaces flag "not a Flux user" without a second query.
  userId: string | null;
  // ISO yyyy-mm-dd (date only); null if Keka has no joining date.
  joiningDate: string | null;
};

type GraphRow = { id: string; managerId: string | null; managerName: string | null };

export type TeamTreeNode = {
  email: string;
  name: string;
  jobTitle: string | null;
  department: string | null;
  children: TeamTreeNode[];
};

/**
 * Walk Keka's reportsTo chain from a person's direct manager up to the top,
 * returning [directManager, theirManager, …]. Guards against self-reports and
 * cycles (Keka's top person reports to themselves) via a visited set. Lifted
 * verbatim from the Lines of Code view so the chains match across surfaces.
 */
export function buildManagerChain(
  directName: string | null,
  directManagerId: string | null,
  graph: Map<string, { managerId: string | null; managerName: string | null }>
): string[] {
  if (!directName) return [];
  const chain = [directName];
  if (!directManagerId) return chain;

  const visited = new Set<string>([directManagerId]);
  let curId: string | null = directManagerId;
  for (let depth = 0; curId && depth < 15; depth++) {
    const node = graph.get(curId);
    if (!node?.managerId || !node.managerName) break;
    if (visited.has(node.managerId)) break; // self-report / cycle → stop
    chain.push(node.managerName);
    visited.add(node.managerId);
    curId = node.managerId;
  }
  return chain;
}

/** Whole tenure in whole days from joiningDate to now; null if unknown. */
export function tenureDays(joiningDate: string | null): number | null {
  if (!joiningDate) return null;
  const joined = new Date(`${joiningDate}T00:00:00Z`).getTime();
  if (Number.isNaN(joined)) return null;
  return Math.max(0, Math.floor((Date.now() - joined) / 86_400_000));
}

/** "new joiner" = joined within the last 90 days. */
export function isNewJoiner(joiningDate: string | null): boolean {
  const d = tenureDays(joiningDate);
  return d !== null && d <= 90;
}

// "use cache" return values must be plain-serialisable, so the cached layer
// returns arrays; the Maps are rebuilt cheaply per request in loadKekaDirectory.
async function loadRaw(): Promise<{ entries: KekaDirectoryEntry[]; graph: GraphRow[] }> {
  "use cache";
  cacheLife("minutes");
  cacheTag(KEKA_DIRECTORY_TAG);

  const entriesRes = await db.execute(sql`
    SELECT
      keka_employee_id AS "kekaEmployeeId",
      email,
      display_name AS "displayName",
      job_title AS "jobTitle",
      department,
      manager_keka_id AS "managerKekaId",
      manager_name AS "managerName",
      manager_email AS "managerEmail",
      user_id AS "userId",
      to_char(joining_date, 'YYYY-MM-DD') AS "joiningDate"
    FROM keka_employees
  `);
  const graphRes = await db.execute(sql`
    SELECT keka_employee_id AS id,
           manager_keka_id AS "managerId",
           manager_name AS "managerName"
    FROM keka_employees
  `);
  return {
    entries: entriesRes.rows as KekaDirectoryEntry[],
    graph: graphRes.rows as GraphRow[],
  };
}

/**
 * In-memory directory with email lookups + manager-chain resolution. Cheap to
 * construct (the directory is small); the underlying query is cached + tagged.
 */
export class KekaDirectory {
  private readonly byEmailMap = new Map<string, KekaDirectoryEntry>();
  // Inverse of the manager link: managerEmail (lowercased) → direct reports.
  // Built once here so "who reports to X" is O(1), the lookup team provisioning
  // needs (the rest of this read-model only walks *up* the chain).
  private readonly reportsByManagerEmail = new Map<string, KekaDirectoryEntry[]>();
  private readonly graph = new Map<
    string,
    { managerId: string | null; managerName: string | null }
  >();

  constructor(entries: KekaDirectoryEntry[], graph: GraphRow[]) {
    for (const e of entries) {
      if (e.email) this.byEmailMap.set(e.email.toLowerCase(), e);
      if (e.managerEmail) {
        const key = e.managerEmail.toLowerCase();
        const reports = this.reportsByManagerEmail.get(key);
        if (reports) reports.push(e);
        else this.reportsByManagerEmail.set(key, [e]);
      }
    }
    for (const g of graph) {
      this.graph.set(g.id, { managerId: g.managerId, managerName: g.managerName });
    }
  }

  /** Directory entry for a work email (case-insensitive), or undefined. */
  get(email: string | null | undefined): KekaDirectoryEntry | undefined {
    if (!email) return undefined;
    return this.byEmailMap.get(email.toLowerCase());
  }

  /** True when the email maps to a current (active) employee. */
  isActive(email: string | null | undefined): boolean {
    return this.get(email) !== undefined;
  }

  /** Reporting line [directManager, …, top] for an email; [] if none/unknown. */
  managerChain(email: string | null | undefined): string[] {
    const e = this.get(email);
    if (!e) return [];
    return buildManagerChain(e.managerName, e.managerKekaId, this.graph);
  }

  /**
   * Direct reports of a manager email (case-insensitive); [] if none. Excludes
   * a self-report (someone whose managerEmail equals their own email), so the
   * org's top person never appears as their own report.
   */
  directReports(managerEmail: string | null | undefined): KekaDirectoryEntry[] {
    if (!managerEmail) return [];
    const key = managerEmail.toLowerCase();
    const reports = this.reportsByManagerEmail.get(key);
    if (!reports) return [];
    return reports.filter((r) => r.email?.toLowerCase() !== key);
  }

  /** Emails that are the direct manager of at least one active employee. */
  managerEmails(): string[] {
    return [...this.reportsByManagerEmail.keys()];
  }

  /**
   * Full downward org subtree rooted at `rootEmail` (the root itself plus
   * every direct/indirect report), built by walking `directReports()`
   * recursively. Mirrors `buildManagerChain`'s defensive shape (a shared
   * `visited` set guards self-reports/cycles, a depth cap bounds runaway
   * chains) but walks down instead of up — this is the one recursive
   * downward walk in the codebase; `directReports()` itself only ever
   * returns one level. Returns null if `rootEmail` doesn't resolve to a
   * current (active) Keka employee — callers must treat that as "no org
   * context", never as an error (same rule as every other lookup here).
   */
  subtree(rootEmail: string | null | undefined): TeamTreeNode | null {
    const root = this.get(rootEmail);
    if (!root?.email) return null;

    const visited = new Set<string>([root.email.toLowerCase()]);
    const build = (entry: KekaDirectoryEntry, depth: number): TeamTreeNode => {
      const node: TeamTreeNode = {
        email: entry.email!.toLowerCase(),
        name: entry.displayName?.trim() || entry.email!.split("@")[0],
        jobTitle: entry.jobTitle,
        department: entry.department,
        children: [],
      };
      if (depth >= 20) return node; // runaway-chain guard, generous margin over managerChain's depth<15
      for (const report of this.directReports(entry.email)) {
        const key = report.email?.toLowerCase();
        if (!key || visited.has(key)) continue; // cycle guard
        visited.add(key);
        node.children.push(build(report, depth + 1));
      }
      return node;
    };
    return build(root, 0);
  }

  get size(): number {
    return this.byEmailMap.size;
  }

  all(): KekaDirectoryEntry[] {
    return [...this.byEmailMap.values()];
  }
}

/** Load the directory read model (cached query, per-request Maps). */
export async function loadKekaDirectory(): Promise<KekaDirectory> {
  const { entries, graph } = await loadRaw();
  return new KekaDirectory(entries, graph);
}
