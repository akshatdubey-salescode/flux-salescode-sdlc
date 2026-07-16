import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";
import { stampCache, withCacheMetrics } from "@/lib/cache/metrics";
import { extractStartDate, extractDueDate } from "@/lib/jira/dates";
import { KEKA_LEAVE_TAG } from "@/lib/keka/cache-tags";
import { loadAbsencesByEmail } from "@/lib/keka/absence";

// ── Date helpers (calendar-day granularity) ───────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Weekend test (Sat/Sun). Availability is reckoned in working days only:
 * weekends are non-working, so they are never reported as a "free" day and a
 * "free from" date always lands on a weekday.
 */
function isWeekend(dateStr: string): boolean {
  const dow = new Date(dateStr + "T00:00:00").getDay(); // 0 = Sun … 6 = Sat
  return dow === 0 || dow === 6;
}

/** First working day on/after the given date (skips Sat/Sun). */
function firstWorkingDay(dateStr: string): string {
  let d = dateStr;
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

/** Fiscal-year start (1 April) for the given date — the default staleness cutoff. */
function fiscalYearStart(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
}

/** Normalize a timestamp column (string or Date, depending on the driver) to YYYY-MM-DD. */
function toDateStr(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type AvailabilityScope = "project" | "team" | "global" | "people";
export type AvailabilityMode = "range" | "duration";

export type ConflictTask = {
  id: string;
  jiraKey: string;
  summary: string;
  projectName: string;
  jiraUrl: string;
  start: string;
  due: string;
};

export type PersonAvailability = {
  email: string;
  name: string;
  /** Open tasks assigned with no start/due date — can't be scheduled around. */
  undated: number;
  // range mode
  free?: boolean;
  conflicts?: ConflictTask[];
  // duration mode
  freeNow?: boolean;
  nextFreeFrom?: string | null;
  /** Working days in the window the person is on Keka leave (corrects "free"). */
  onLeaveDates?: string[];
};

export type AvailabilityResponse = {
  scope: AvailabilityScope;
  mode: AvailabilityMode;
  /** Stale-work cutoff: only issues updated on/after this date were counted. */
  activeSince: string;
  range?: { start: string; end: string };
  duration?: { days: number; from: string; horizonEnd: string };
  people: PersonAvailability[];
};

type Person = { email: string; name: string };

type TaskRow = {
  id: string;
  jira_key: string;
  summary: string;
  status_category: string | null;
  canonical_status: string;
  assignee_email: string | null;
  additional_assignee_emails: string[] | null;
  custom_fields: Record<string, unknown>;
  jira_created_at: string | Date | null;
  project_name: string;
  jira_base_url: string;
  end_date_field_ids: string[] | null;
  start_date_field_ids: string[] | null;
};

const OPEN_FILTER = sql`NOT (
  lower(ji.status_category) = 'done'
  OR lower(ji.status_category) LIKE '%complete%'
  OR lower(ji.status_category) LIKE '%closed%'
)`;

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    await requireAuth();
    const url = new URL(request.url);
    const p = url.searchParams;

    const rawNow = p.get("now") ?? new Date().toISOString().slice(0, 19);
    const today = rawNow.slice(0, 10);

    const scope = (p.get("scope") ?? "global") as AvailabilityScope;
    const mode = (p.get("mode") ?? "range") as AvailabilityMode;

    const projectId = p.get("projectId");
    const boardId = p.get("boardId");
    const emails = (p.get("emails") ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    // Range params
    const start = p.get("start") ?? today;
    const end = p.get("end") ?? today;
    // Duration params
    const duration = Math.max(1, parseInt(p.get("duration") ?? "1", 10) || 1);
    const from = p.get("from") ?? today;
    // Capped at a year: nextFreeSlot scans calendar-day-by-day to horizonEnd, so
    // an unbounded value would let a single request drive a runaway scan.
    const horizon = Math.min(
      365,
      Math.max(1, parseInt(p.get("horizon") ?? "60", 10) || 60)
    );

    // Ignore stale work: only count issues touched on/after this cutoff.
    const activeSince = p.get("activeSince") ?? fiscalYearStart(today);

    const { data, headers } = await withCacheMetrics("availability", () =>
      fetchAvailability({
        scope,
        mode,
        projectId,
        boardId,
        emails,
        start,
        end,
        duration,
        from,
        horizon,
        activeSince,
      })
    );
    return NextResponse.json(data, { headers });
  } catch (error) {
    console.error("Availability error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

async function fetchAvailability(opts: {
  scope: AvailabilityScope;
  mode: AvailabilityMode;
  projectId: string | null;
  boardId: string | null;
  emails: string[];
  start: string;
  end: string;
  duration: number;
  from: string;
  horizon: number;
  activeSince: string;
}): Promise<ReturnType<typeof stampCache>> {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues", "availability", KEKA_LEAVE_TAG);

  const people = await resolvePeople(opts.scope, opts.projectId, opts.boardId, opts.emails);

  if (people.length === 0) {
    return stampCache({
      scope: opts.scope,
      mode: opts.mode,
      activeSince: opts.activeSince,
      people: [],
    } satisfies AvailabilityResponse);
  }

  const targetSet = new Set(people.map((p) => p.email));
  const emailList = sql.join(
    [...targetSet].map((e) => sql`${e}`),
    sql`, `
  );

  // Every open task across all active projects assigned (primary or via the
  // multi-assignee picker) to any person in scope. Availability is global:
  // a person's busy windows come from all their work, not just one project.
  const rows = (
    await db.execute(sql`
      SELECT
        ji.id,
        ji.jira_key,
        ji.summary,
        ji.status_category,
        psm.canonical_status,
        ji.assignee_email,
        ji.additional_assignee_emails,
        ji.custom_fields,
        ji.jira_created_at,
        jp.name AS project_name,
        jp.jira_base_url,
        jp.end_date_field_ids,
        jp.start_date_field_ids
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id AND jp.is_active = true
      JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
      WHERE ${OPEN_FILTER}
        AND (
          lower(ji.assignee_email) IN (${emailList})
          OR EXISTS (
            SELECT 1 FROM unnest(ji.additional_assignee_emails) AS ae
            WHERE lower(ae) IN (${emailList})
          )
        )
    `)
  ).rows as TaskRow[];

  type Bucket = { conflicts: ConflictTask[]; intervals: { start: string; due: string }[]; undated: number };
  const byEmail = new Map<string, Bucket>();
  for (const e of targetSet) byEmail.set(e, { conflicts: [], intervals: [], undated: 0 });

  for (const r of rows) {
    if (r.canonical_status === "CANCELLED") continue;

    // Which in-scope people does this task occupy?
    const attributed = new Set<string>();
    const primary = r.assignee_email?.trim().toLowerCase();
    if (primary && targetSet.has(primary)) attributed.add(primary);
    for (const ae of r.additional_assignee_emails ?? []) {
      const e = ae?.trim().toLowerCase();
      if (e && targetSet.has(e)) attributed.add(e);
    }
    if (attributed.size === 0) continue;

    const cf = (r.custom_fields as Record<string, unknown>) ?? {};
    const startDate = extractStartDate(cf, r.start_date_field_ids);
    const dueDate = extractDueDate(cf, r.end_date_field_ids);

    for (const email of attributed) {
      const bucket = byEmail.get(email)!;
      if (startDate && dueDate) {
        // Dated work: relevance is its start–due window (handled per query mode),
        // so no staleness cutoff here — same as the dashboard's active/overdue.
        bucket.intervals.push({ start: startDate, due: dueDate });
        bucket.conflicts.push({
          id: r.id,
          jiraKey: r.jira_key,
          summary: r.summary,
          projectName: r.project_name,
          jiraUrl: `${r.jira_base_url.replace(/\/$/, "")}/browse/${r.jira_key}`,
          start: startDate,
          due: dueDate,
        });
      } else {
        // Undated work mirrors the dashboard's "Unplanned": count an undated open
        // task only if it was created on/after the cutoff. Old undated tickets
        // (created earlier) are stale and ignored.
        const created = toDateStr(r.jira_created_at);
        if (created && created >= opts.activeSince) bucket.undated++;
      }
    }
  }

  const horizonEnd = addDays(opts.from, opts.horizon - 1);

  // Keka leave overlay for the relevant window. Closes the "shows Free while on
  // leave" gap: a dated Jira task isn't the only reason a person is unavailable.
  const absences = await loadAbsencesByEmail(
    opts.mode === "range" ? opts.start : opts.from,
    opts.mode === "range" ? opts.end : horizonEnd
  );

  const result: PersonAvailability[] = people.map((person) => {
    const b = byEmail.get(person.email)!;
    const leaveSet = absences.get(person.email) ?? new Set<string>();
    const base = { email: person.email, name: person.name, undated: b.undated };

    if (opts.mode === "range") {
      const conflicts = b.conflicts
        .filter((c) => c.start <= opts.end && c.due >= opts.start)
        .sort((a, c) => (a.due < c.due ? -1 : 1));
      // On-leave working days inside the range make a person not "free", even
      // with zero task conflicts.
      const onLeaveDates = [...leaveSet]
        .filter((d) => d >= opts.start && d <= opts.end && !isWeekend(d))
        .sort();
      return {
        ...base,
        free: conflicts.length === 0 && onLeaveDates.length === 0,
        conflicts,
        onLeaveDates,
      };
    }

    // duration mode — weekends are skipped, so the earliest a slot can start is
    // the first working day on/after `from`; "free now" means their next free
    // slot starts exactly there. Leave days are treated as busy.
    const earliestStart = firstWorkingDay(opts.from);
    const nextFreeFrom = nextFreeSlot(
      b.intervals,
      opts.from,
      horizonEnd,
      opts.duration,
      leaveSet
    );
    const onLeaveDates = [...leaveSet].filter((d) => !isWeekend(d)).sort();
    return { ...base, freeNow: nextFreeFrom === earliestStart, nextFreeFrom, onLeaveDates };
  });

  // Most useful first.
  if (opts.mode === "range") {
    result.sort(
      (a, c) =>
        Number(c.free) - Number(a.free) ||
        a.undated - c.undated ||
        a.name.localeCompare(c.name)
    );
  } else {
    result.sort((a, c) => {
      const av = a.nextFreeFrom ?? "9999-12-31";
      const cv = c.nextFreeFrom ?? "9999-12-31";
      return av < cv ? -1 : av > cv ? 1 : a.name.localeCompare(c.name);
    });
  }

  const response: AvailabilityResponse = {
    scope: opts.scope,
    mode: opts.mode,
    activeSince: opts.activeSince,
    people: result,
    ...(opts.mode === "range"
      ? { range: { start: opts.start, end: opts.end } }
      : { duration: { days: opts.duration, from: opts.from, horizonEnd } }),
  };
  return stampCache(response);
}

/**
 * Earliest start date of a free slot of `duration` WORKING days (Mon–Fri)
 * within [from, searchEnd], or null. Weekends are skipped entirely — they
 * count neither as free days nor toward the required length, so a slot may
 * span a weekend (e.g. Fri + Mon for duration 2) and the returned date is
 * always a weekday, never a Saturday or Sunday.
 */
function nextFreeSlot(
  intervals: { start: string; due: string }[],
  from: string,
  searchEnd: string,
  duration: number,
  leave?: Set<string>
): string | null {
  const busyOn = (d: string) =>
    intervals.some((iv) => iv.start <= d && iv.due >= d) ||
    (leave?.has(d) ?? false);

  let runStart: string | null = null;
  let runLen = 0;
  for (let d = from; d <= searchEnd; d = addDays(d, 1)) {
    if (isWeekend(d)) continue; // non-working day — neither free nor counted
    if (busyOn(d)) {
      runStart = null;
      runLen = 0;
      continue;
    }
    if (runLen === 0) runStart = d;
    runLen++;
    if (runLen >= duration) return runStart;
  }
  return null;
}

// ── People resolution per scope ───────────────────────────────────────────────

async function resolvePeople(
  scope: AvailabilityScope,
  projectId: string | null,
  boardId: string | null,
  emails: string[]
): Promise<Person[]> {
  if (scope === "project") {
    if (!projectId) return [];
    const res = await db.execute(sql`
      SELECT lower(assignee_email) AS email, MIN(assignee_name) AS name
      FROM jira_issues
      WHERE project_id = ${projectId}
        AND assignee_email IS NOT NULL AND assignee_email <> ''
      GROUP BY lower(assignee_email)
    `);
    return toPeople(res.rows as { email: string; name: string | null }[]);
  }

  if (scope === "team") {
    if (!boardId) return [];
    const [members, board] = await Promise.all([
      db.execute(sql`
        SELECT lower(email) AS email, name FROM observer_board_members WHERE board_id = ${boardId}
      `),
      db.execute(sql`
        SELECT lower(manager_email) AS email, manager_name AS name
        FROM observer_boards WHERE id = ${boardId} AND manager_email IS NOT NULL
      `),
    ]);
    return toPeople([
      ...(members.rows as { email: string; name: string | null }[]),
      ...(board.rows as { email: string; name: string | null }[]),
    ]);
  }

  if (scope === "people") {
    if (emails.length === 0) return [];
    const list = sql.join(emails.map((e) => sql`${e}`), sql`, `);
    const res = await db.execute(sql`
      SELECT lower(email) AS email, name FROM observer_board_members WHERE lower(email) IN (${list})
      UNION
      SELECT lower(assignee_email) AS email, MIN(assignee_name) AS name
      FROM jira_issues
      WHERE lower(assignee_email) IN (${list})
      GROUP BY lower(assignee_email)
    `);
    const named = toPeople(res.rows as { email: string; name: string | null }[]);
    const haveName = new Map(named.map((p) => [p.email, p]));
    // Keep every requested email even if we found no display name for it.
    return emails.map(
      (e) => haveName.get(e) ?? { email: e, name: e.split("@")[0] }
    );
  }

  // global — every assignee across active projects + all board members
  const res = await db.execute(sql`
    SELECT email, name FROM (
      SELECT lower(ji.assignee_email) AS email, MIN(ji.assignee_name) AS name
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id AND jp.is_active = true
      WHERE ji.assignee_email IS NOT NULL AND ji.assignee_email <> ''
      GROUP BY lower(ji.assignee_email)
      UNION
      SELECT lower(email) AS email, name FROM observer_board_members
    ) t
  `);
  return toPeople(res.rows as { email: string; name: string | null }[]);
}

function toPeople(rows: { email: string; name: string | null }[]): Person[] {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (!r.email) continue;
    const name = r.name?.trim() || r.email.split("@")[0];
    // Prefer the first non-email-derived name we see.
    if (!map.has(r.email) || map.get(r.email) === r.email.split("@")[0]) {
      map.set(r.email, name);
    }
  }
  return [...map.entries()]
    .map(([email, name]) => ({ email, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
