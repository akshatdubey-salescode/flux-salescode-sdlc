import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { kekaAttendance, kekaEmployees } from "@/lib/db/schema";
import { getKekaClient, type KekaAttendanceRaw } from "./client";

function toNum(v: unknown): number | null {
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

function toTs(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayTypeStr(v: KekaAttendanceRaw["dayType"]): string | null {
  return v === null || v === undefined ? null : String(v);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Pull Keka attendance for a window and upsert it into keka_attendance, one row
 * per (employeeNumber, date). Idempotent (keyed on the natural composite), and
 * it never prunes — historical attendance must survive a directory prune.
 *
 * Default window is the trailing `trailingDays` (incl. today, UTC), optionally
 * extended `forwardDays` into the future — mirrors syncKekaLeave's trailing+
 * forward shape, since a forward window on attendance is mostly useful for the
 * upcoming weekly-off/holiday calendar (dayType), not for real punches that
 * haven't happened yet (see isCompletedDay below). Pass an explicit from/to for
 * a backfill (the client chunks it into ≤90-day requests).
 *
 * `isAbsent` is derived: a WORKING day (dayType 0) with no clock-in and no
 * effective hours. dayType was decoded empirically from live data (2026-06-25):
 * 0 = working day, 2 = weekly-off, 1 = holiday — so weekly-offs/holidays are
 * never counted as absence. The raw payload is preserved on every row in case
 * the enum needs re-decoding.
 */
export async function syncKekaAttendance(opts?: {
  from?: string;
  to?: string;
  trailingDays?: number;
  forwardDays?: number;
}): Promise<{ synced: number; errors: number; skipped: number; from: string; to: string }> {
  const trailing = opts?.trailingDays ?? 35;
  const forward = opts?.forwardDays ?? 0;
  const today = new Date();
  const todayIso = isoDate(today);
  const to = opts?.to ?? isoDate(new Date(today.getTime() + forward * 86_400_000));
  const from =
    opts?.from ?? isoDate(new Date(today.getTime() - (trailing - 1) * 86_400_000));

  const client = getKekaClient();
  const records = await client.fetchAttendance({ from, to });

  // employee_number → directory GUID, for the best-effort link.
  const empRows = await db
    .select({
      id: kekaEmployees.kekaEmployeeId,
      num: kekaEmployees.employeeNumber,
    })
    .from(kekaEmployees);
  const guidByNumber = new Map<string, string>();
  for (const r of empRows) if (r.num) guidByNumber.set(r.num, r.id);

  let synced = 0;
  let errors = 0;
  let skipped = 0;

  for (const rec of records) {
    const employeeNumber = rec.employeeNumber ?? null;
    const attendanceDate = rec.attendanceDate ? rec.attendanceDate.slice(0, 10) : null;
    if (!employeeNumber || !attendanceDate) {
      skipped++;
      continue;
    }

    const firstIn = toTs(rec.firstInOfTheDay?.timestamp);
    const lastOut = toTs(rec.lastOutOfTheDay?.timestamp);
    const grossHours = toNum(rec.totalGrossHours);
    const effectiveHours = toNum(rec.totalEffectiveHours);
    // Only a working day (dayType 0) with no clock-in and no effective hours is
    // a real absence/leave. Weekly-offs (2) and holidays (1) are never absences.
    // The current/future day is excluded: it's incomplete (punches not in yet),
    // so every record would look absent — only completed past days are flagged.
    const isWorkingDay = dayTypeStr(rec.dayType) === "0";
    const isCompletedDay = attendanceDate < todayIso;
    const isAbsent =
      isCompletedDay &&
      isWorkingDay &&
      !firstIn &&
      (effectiveHours === null || effectiveHours === 0);

    try {
      await db
        .insert(kekaAttendance)
        .values({
          employeeNumber,
          kekaEmployeeId: guidByNumber.get(employeeNumber) ?? null,
          attendanceDate,
          dayType: dayTypeStr(rec.dayType),
          totalGrossHours: grossHours,
          totalEffectiveHours: effectiveHours,
          firstIn,
          lastOut,
          isAbsent,
          raw: rec as Record<string, unknown>,
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [kekaAttendance.employeeNumber, kekaAttendance.attendanceDate],
          set: {
            kekaEmployeeId: sql`excluded.keka_employee_id`,
            dayType: sql`excluded.day_type`,
            totalGrossHours: sql`excluded.total_gross_hours`,
            totalEffectiveHours: sql`excluded.total_effective_hours`,
            firstIn: sql`excluded.first_in`,
            lastOut: sql`excluded.last_out`,
            isAbsent: sql`excluded.is_absent`,
            raw: sql`excluded.raw`,
            syncedAt: sql`excluded.synced_at`,
            updatedAt: sql`now()`,
          },
        });
      synced++;
    } catch {
      errors++;
    }
  }

  return { synced, errors, skipped, from, to };
}
