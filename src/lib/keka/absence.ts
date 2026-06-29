import { cacheLife, cacheTag } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { KEKA_LEAVE_TAG } from "./cache-tags";

// lower(email) → set of YYYY-MM-DD dates the person is on leave.
export type AbsenceMap = Map<string, Set<string>>;

// lower(email) → { dates on leave, distinct leave-type names in the window }.
export type LeaveInfo = { dates: Set<string>; types: Set<string> };
export type LeaveMap = Map<string, LeaveInfo>;

type Row = { email: string; date: string; type: string | null };

// "use cache" return values must be plain-serialisable, so the cached layer
// returns rows; Maps/Sets are built per-request by the callers below.
async function loadLeaveRows(start: string, end: string): Promise<Row[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(KEKA_LEAVE_TAG);

  // Approved leave (status=1) expanded to one row per leave date within
  // [start, end], joined to people on employee_number. Weekends are dropped —
  // a Fri–Mon leave shouldn't paint Sat/Sun (which are non-working anyway).
  const res = await db.execute(sql`
    SELECT lower(ke.email) AS email,
           to_char(d, 'YYYY-MM-DD') AS date,
           kl.leave_type_name AS type
    FROM keka_leave kl
    JOIN keka_employees ke ON ke.employee_number = kl.employee_number
    CROSS JOIN LATERAL generate_series(
      greatest(kl.from_date, ${start}::date),
      least(kl.to_date, ${end}::date),
      interval '1 day'
    ) AS d
    WHERE kl.status = 1
      AND ke.email IS NOT NULL
      AND kl.from_date <= ${end}::date
      AND kl.to_date >= ${start}::date
      AND extract(dow from d) NOT IN (0, 6)
  `);
  return res.rows as Row[];
}

/**
 * On-leave dates + leave-type names per person across [start, end] (inclusive),
 * keyed by lowercased work email. The single consumer point for absence-aware
 * surfaces (Gantt overlay, day-view badge, availability, SLA pausing). Sourced
 * from approved Keka leave requests — accurate, typed, and known ahead of time.
 */
export async function loadLeaveByEmail(start: string, end: string): Promise<LeaveMap> {
  const rows = await loadLeaveRows(start, end);
  const map: LeaveMap = new Map();
  for (const r of rows) {
    let info = map.get(r.email);
    if (!info) {
      info = { dates: new Set<string>(), types: new Set<string>() };
      map.set(r.email, info);
    }
    info.dates.add(r.date);
    if (r.type) info.types.add(r.type);
  }
  return map;
}

/** Dates-only view (for SLA / availability that don't need leave types). */
export async function loadAbsencesByEmail(
  start: string,
  end: string
): Promise<AbsenceMap> {
  const leave = await loadLeaveByEmail(start, end);
  const out: AbsenceMap = new Map();
  for (const [email, info] of leave) out.set(email, info.dates);
  return out;
}

/** True if `email` is on leave on `date` (YYYY-MM-DD) per the given map. */
export function isAbsentOn(
  map: AbsenceMap,
  email: string | null | undefined,
  date: string
): boolean {
  if (!email) return false;
  return map.get(email.toLowerCase())?.has(date) ?? false;
}
