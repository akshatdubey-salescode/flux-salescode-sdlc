import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { kekaLeave } from "@/lib/db/schema";
import { getKekaClient } from "./client";

// Keka leave-request status enum (decoded live 2026-06-29).
const STATUS_LABELS: Record<number, string> = {
  0: "Pending",
  1: "Approved",
  2: "Rejected",
  3: "Cancelled",
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function toDateOnly(v: unknown): string | null {
  return typeof v === "string" && v ? v.slice(0, 10) : null;
}
function toTs(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function toIntOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Pull Keka leave requests for a window and upsert into keka_leave (one row per
 * request, keyed on the request GUID). The window spans trailing `pastDays` and
 * forward `futureDays` because leave is filed AHEAD — pulling the future lets
 * the Gantt show upcoming leave. Idempotent; cancellations come back as status 3
 * and update in place. Never prunes.
 */
export async function syncKekaLeave(opts?: {
  from?: string;
  to?: string;
  pastDays?: number;
  futureDays?: number;
}): Promise<{ synced: number; errors: number; skipped: number; from: string; to: string }> {
  const pastDays = opts?.pastDays ?? 30;
  const futureDays = opts?.futureDays ?? 60;
  const today = new Date();
  const from = opts?.from ?? isoDate(new Date(today.getTime() - pastDays * 86_400_000));
  const to = opts?.to ?? isoDate(new Date(today.getTime() + futureDays * 86_400_000));

  const client = getKekaClient();
  const records = await client.fetchLeaveRequests({ from, to });

  let synced = 0;
  let errors = 0;
  let skipped = 0;

  for (const rec of records) {
    const kekaLeaveId = rec.id ?? null;
    const employeeNumber = rec.employeeNumber ?? null;
    const fromDate = toDateOnly(rec.fromDate);
    const toDate = toDateOnly(rec.toDate);
    if (!kekaLeaveId || !employeeNumber || !fromDate || !toDate) {
      skipped++;
      continue;
    }

    // A request usually has one selection; denormalise the first for querying,
    // keep the whole record in `raw` for multi-type fidelity.
    const sel = rec.selection?.[0];
    const status = toIntOrNull(rec.status);

    try {
      await db
        .insert(kekaLeave)
        .values({
          kekaLeaveId,
          employeeNumber,
          employeeIdentifier: rec.employeeIdentifier ?? null,
          fromDate,
          toDate,
          fromSession: toIntOrNull(rec.fromSession),
          toSession: toIntOrNull(rec.toSession),
          status,
          statusLabel: status !== null ? STATUS_LABELS[status] ?? null : null,
          leaveTypeName: sel?.leaveTypeName ?? null,
          leaveTypeId: sel?.leaveTypeIdentifier ?? null,
          note: typeof rec.note === "string" ? rec.note : null,
          requestedOn: toTs(rec.requestedOn),
          raw: rec as Record<string, unknown>,
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: kekaLeave.kekaLeaveId,
          set: {
            employeeNumber: sql`excluded.employee_number`,
            employeeIdentifier: sql`excluded.employee_identifier`,
            fromDate: sql`excluded.from_date`,
            toDate: sql`excluded.to_date`,
            fromSession: sql`excluded.from_session`,
            toSession: sql`excluded.to_session`,
            status: sql`excluded.status`,
            statusLabel: sql`excluded.status_label`,
            leaveTypeName: sql`excluded.leave_type_name`,
            leaveTypeId: sql`excluded.leave_type_id`,
            note: sql`excluded.note`,
            requestedOn: sql`excluded.requested_on`,
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
