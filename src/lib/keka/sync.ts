import { notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { kekaEmployees } from "@/lib/db/schema";
import { getKekaClient, type KekaEmployeeRaw } from "./client";

// Keka employmentStatus is a numeric enum.
const EMPLOYMENT_STATUS_LABELS: Record<number, string> = {
  0: "Working",
  1: "Relieved",
};

// jobTitle is a LookupInfo { identifier, title } on most tenants but can come
// back as a plain string — normalise both to a string.
function lookupTitle(v: KekaEmployeeRaw["jobTitle"]): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  return typeof v.title === "string" ? v.title : null;
}

function toDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function lower(v: string | null | undefined): string | null {
  return v ? v.toLowerCase() : null;
}

/**
 * Pull the full Keka employee directory and upsert it into keka_employees,
 * then resolve newly-seen emails to app users. Returns counts for the caller
 * (cron route / script) to report.
 *
 * Idempotent: keyed on Keka's GUID, so re-running refreshes existing rows.
 * userId / resolvedVia are intentionally left untouched by the upsert — they
 * are owned by resolveKekaIdentities().
 */
export async function syncKekaEmployees(): Promise<{
  synced: number;
  errors: number;
  resolved: number;
  pruned: number;
}> {
  const client = getKekaClient();
  // Active employees only. Filtered at the API (employmentStatus=Working) and
  // again client-side (0 = Working) as a safety net in case the API ignores it.
  const fetched = await client.fetchEmployees({ employmentStatus: "Working" });
  const employees = fetched.filter((e) => e.employmentStatus === 0);

  let synced = 0;
  let errors = 0;

  for (const e of employees) {
    try {
      const status = typeof e.employmentStatus === "number" ? e.employmentStatus : null;
      const mgr = e.reportsTo ?? null;
      const managerName = mgr
        ? [mgr.firstName, mgr.lastName].filter(Boolean).join(" ") || null
        : null;

      await db
        .insert(kekaEmployees)
        .values({
          kekaEmployeeId: e.id,
          employeeNumber: e.employeeNumber ?? null,
          displayName: e.displayName ?? null,
          firstName: e.firstName ?? null,
          lastName: e.lastName ?? null,
          email: lower(e.email),
          jobTitle: lookupTitle(e.jobTitle),
          // Keka exposes no first-class department field; it lives under
          // `groups`, preserved in `raw` for later extraction.
          department: null,
          employmentStatus: status,
          employmentStatusLabel:
            status !== null ? EMPLOYMENT_STATUS_LABELS[status] ?? null : null,
          joiningDate: toDate(e.joiningDate),
          exitDate: toDate(e.exitDate),
          managerKekaId: mgr?.id ?? null,
          managerEmail: lower(mgr?.email),
          managerName,
          raw: e as Record<string, unknown>,
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: kekaEmployees.kekaEmployeeId,
          set: {
            employeeNumber: sql`excluded.employee_number`,
            displayName: sql`excluded.display_name`,
            firstName: sql`excluded.first_name`,
            lastName: sql`excluded.last_name`,
            email: sql`excluded.email`,
            jobTitle: sql`excluded.job_title`,
            department: sql`excluded.department`,
            employmentStatus: sql`excluded.employment_status`,
            employmentStatusLabel: sql`excluded.employment_status_label`,
            joiningDate: sql`excluded.joining_date`,
            exitDate: sql`excluded.exit_date`,
            managerKekaId: sql`excluded.manager_keka_id`,
            managerEmail: sql`excluded.manager_email`,
            managerName: sql`excluded.manager_name`,
            raw: sql`excluded.raw`,
            syncedAt: sql`excluded.synced_at`,
            updatedAt: sql`now()`,
            // NB: user_id / resolved_via deliberately NOT overwritten — owned
            // by resolveKekaIdentities(), not the directory pull.
          },
        });
      synced++;
    } catch {
      errors++;
    }
  }

  // Prune anyone no longer in the active set (now relieved / left Keka) so the
  // table mirrors only current active employees. Guarded so an empty or failed
  // fetch never wipes the table.
  let pruned = 0;
  if (employees.length > 0) {
    const activeIds = employees.map((e) => e.id);
    const removed = await db
      .delete(kekaEmployees)
      .where(notInArray(kekaEmployees.kekaEmployeeId, activeIds))
      .returning({ id: kekaEmployees.id });
    pruned = removed.length;
  }

  const { resolved } = await resolveKekaIdentities();
  return { synced, errors, resolved, pruned };
}

/**
 * Bridge synced Keka employees to app users by work email. Only fills rows that
 * are still unresolved, so a future manual mapping (resolved_via='manual') is
 * never clobbered. Mirrors resolveGithubIdentities(). ke.email is already stored
 * lowercased at sync time; users.email is lowercased here for the join.
 */
export async function resolveKekaIdentities(): Promise<{ resolved: number }> {
  const result = await db.execute(sql`
    UPDATE keka_employees AS ke
    SET user_id = u.id,
        resolved_via = 'email_auto',
        updated_at = now()
    FROM users AS u
    WHERE ke.user_id IS NULL
      AND ke.email IS NOT NULL
      AND ke.email = lower(u.email)
  `);
  return { resolved: result.rowCount ?? 0 };
}
