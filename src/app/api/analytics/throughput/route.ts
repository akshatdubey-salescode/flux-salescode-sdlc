import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";
import { stampCache, withCacheMetrics } from "@/lib/cache/metrics";
import { currentFiscalQuarterChip } from "@/lib/date-utils";
import { KEKA_DIRECTORY_TAG } from "@/lib/keka/cache-tags";
import { loadKekaDirectory, tenureDays } from "@/lib/keka/directory";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ClosedIssue = {
  jiraKey: string;
  summary: string;
  projectName: string;
  jiraUrl: string;
  /** Day the issue first transitioned to a DONE status (YYYY-MM-DD). */
  completedAt: string;
  /**
   * True when this person also reported the issue (self-created work) vs work
   * reported by someone else (e.g. a client/manager-raised task).
   */
  selfReported: boolean;
};

export type PersonThroughput = {
  email: string;
  name: string;
  /** Distinct issues closed in the period credited to this person. */
  closed: number;
  /** Subset closed where they were the primary assignee. */
  asPrimary: number;
  /** Subset closed where they were only an additional assignee. */
  asAdditional: number;
  /** Subset closed where this person also reported the issue (self-created). */
  selfReported: number;
  /** Subset closed reported by someone else (assigned / client work). */
  othersReported: number;
  // Keka org context — null/empty when the person isn't a current employee.
  department: string | null;
  managerName: string | null;
  managerChain: string[];
  jobTitle: string | null;
  tenureDays: number | null;
  isActive: boolean;
  issues: ClosedIssue[];
};

export type ThroughputResponse = {
  range: { start: string; end: string };
  /** Distinct issues closed org-wide in the period (not the sum of per-person counts). */
  totalClosed: number;
  people: PersonThroughput[];
};

type IssueRow = {
  jira_key: string;
  summary: string;
  completed_at: string | Date | null;
  assignee_email: string | null;
  assignee_name: string | null;
  assignee_account_id: string | null;
  additional_assignee_emails: string[] | null;
  reporter_account_id: string | null;
  reporter_email: string | null;
  canonical_status: string;
  project_name: string;
  jira_base_url: string;
};

/** Normalize a timestamp column (string or Date, depending on the driver) to YYYY-MM-DD. */
function toDateStr(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    await requireAuth();
    const url = new URL(request.url);
    const p = url.searchParams;

    const fq = currentFiscalQuarterChip();
    const start = p.get("start") ?? fq.start;
    const end = p.get("end") ?? fq.end;
    const emails = (p.get("emails") ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const { data, headers } = await withCacheMetrics("throughput", () =>
      fetchThroughput({ start, end, emails })
    );
    return NextResponse.json(data, { headers });
  } catch (error) {
    console.error("Throughput error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

async function fetchThroughput(opts: {
  start: string;
  end: string;
  emails: string[];
}): Promise<ReturnType<typeof stampCache>> {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues", "throughput", KEKA_DIRECTORY_TAG);

  // Optional focus filter: when non-empty, only credit these people.
  const focus = opts.emails.length ? new Set(opts.emails) : null;

  // Every issue whose most-recent completion landed within the period, across
  // active projects. `completed_at` is the timestamp of the latest non-DONE→DONE
  // transition: it survives a reopen and only advances if the issue is re-closed.
  const rows = (
    await db.execute(sql`
      SELECT
        ji.jira_key,
        ji.summary,
        ji.completed_at,
        ji.assignee_email,
        ji.assignee_name,
        ji.assignee_account_id,
        ji.additional_assignee_emails,
        ji.reporter_account_id,
        ji.reporter_email,
        psm.canonical_status,
        jp.name AS project_name,
        jp.jira_base_url
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id AND jp.is_active = true
      JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
      WHERE ji.completed_at IS NOT NULL
        AND ji.completed_at::date >= ${opts.start}::date
        AND ji.completed_at::date <= ${opts.end}::date
    `)
  ).rows as IssueRow[];

  type Acc = {
    name: string;
    closed: number;
    asPrimary: number;
    asAdditional: number;
    selfReported: number;
    othersReported: number;
    issues: ClosedIssue[];
  };
  const byEmail = new Map<string, Acc>();
  const nameFor = (email: string, fallback: string | null) =>
    fallback?.trim() || email.split("@")[0];

  let totalClosed = 0;

  for (const r of rows) {
    // A completed issue later moved to CANCELLED isn't a closed deliverable.
    if (r.canonical_status === "CANCELLED") continue;
    totalClosed++;

    const completedAt = toDateStr(r.completed_at) ?? opts.start;
    const jiraUrl = `${r.jira_base_url.replace(/\/$/, "")}/browse/${r.jira_key}`;
    const base = {
      jiraKey: r.jira_key,
      summary: r.summary,
      projectName: r.project_name,
      jiraUrl,
      completedAt,
    };

    // Reporter identity — distinguishes self-created work from work raised by
    // someone else. Match by accountId when available (survives Atlassian email
    // privacy), otherwise fall back to email.
    const reporterAccount = r.reporter_account_id?.trim() || null;
    const reporterEmail = r.reporter_email?.trim().toLowerCase() || null;
    const assigneeAccount = r.assignee_account_id?.trim() || null;

    // Distinct people this issue is credited to, tracking how each held it.
    const primary = r.assignee_email?.trim().toLowerCase() || null;
    const additional = new Set(
      (r.additional_assignee_emails ?? [])
        .map((e) => e?.trim().toLowerCase())
        .filter((e): e is string => !!e && e !== primary)
    );

    // Did the primary assignee also report it? Prefer accountId, else email.
    const primarySelf =
      (!!reporterAccount && !!assigneeAccount && reporterAccount === assigneeAccount) ||
      (!!reporterEmail && !!primary && reporterEmail === primary);

    const credit = (
      email: string,
      isPrimary: boolean,
      selfReported: boolean,
      displayName: string | null
    ) => {
      if (focus && !focus.has(email)) return;
      let acc = byEmail.get(email);
      if (!acc) {
        acc = {
          name: nameFor(email, displayName),
          closed: 0,
          asPrimary: 0,
          asAdditional: 0,
          selfReported: 0,
          othersReported: 0,
          issues: [],
        };
        byEmail.set(email, acc);
      } else if (displayName?.trim() && acc.name === email.split("@")[0]) {
        acc.name = displayName.trim();
      }
      acc.closed++;
      if (isPrimary) acc.asPrimary++;
      else acc.asAdditional++;
      if (selfReported) acc.selfReported++;
      else acc.othersReported++;
      acc.issues.push({ ...base, selfReported });
    };

    if (primary) credit(primary, true, primarySelf, r.assignee_name);
    // Additional assignees only carry emails, so match the reporter on email.
    for (const ae of additional)
      credit(ae, false, !!reporterEmail && ae === reporterEmail, null);
  }

  const dir = await loadKekaDirectory();
  const people: PersonThroughput[] = [...byEmail.entries()]
    .map(([email, a]) => {
      const e = dir.get(email);
      return {
        email,
        // Prefer Keka's canonical display name over the Jira assignee name.
        name: e?.displayName ?? a.name,
        closed: a.closed,
        asPrimary: a.asPrimary,
        asAdditional: a.asAdditional,
        selfReported: a.selfReported,
        othersReported: a.othersReported,
        department: e?.department ?? null,
        managerName: e?.managerName ?? null,
        managerChain: dir.managerChain(email),
        jobTitle: e?.jobTitle ?? null,
        tenureDays: tenureDays(e?.joiningDate ?? null),
        isActive: e !== undefined,
        issues: a.issues.sort((x, y) => (x.completedAt < y.completedAt ? 1 : -1)),
      };
    })
    .sort((a, b) => b.closed - a.closed || a.name.localeCompare(b.name));

  const response: ThroughputResponse = {
    range: { start: opts.start, end: opts.end },
    totalClosed,
    people,
  };
  return stampCache(response);
}
