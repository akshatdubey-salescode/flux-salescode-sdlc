"use server";

import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { kekaEmployees, users } from "@/lib/db/schema";
import {
  KEKA_ATTENDANCE_TAG,
  KEKA_DIRECTORY_TAG,
  KEKA_LEAVE_TAG,
} from "@/lib/keka/cache-tags";
import { syncKekaEmployees } from "@/lib/keka/sync";
import { syncKekaAttendance } from "@/lib/keka/attendance-sync";
import { syncKekaLeave } from "@/lib/keka/leave-sync";

export type KekaSyncResult =
  | { ok: true; synced: number; errors: number; resolved: number; pruned: number }
  | { ok: false; error: string };

export type KekaAttendanceSyncResult =
  | { ok: true; synced: number; errors: number; skipped: number; from: string; to: string }
  | { ok: false; error: string };

export type KekaLeaveSyncResult =
  | { ok: true; synced: number; errors: number; skipped: number; from: string; to: string }
  | { ok: false; error: string };

/**
 * Pull the Keka employee directory on demand and auto-link by email. Runs
 * inline (the directory is small); surfaces any error (e.g. an invalid_grant
 * from stale creds) back to the UI instead of throwing.
 */
export async function syncKekaNow(): Promise<KekaSyncResult> {
  await requireRole("SUPERUSER");
  try {
    const { synced, errors, resolved, pruned } = await syncKekaEmployees();
    revalidateTag(KEKA_DIRECTORY_TAG, "max");
    return { ok: true, synced, errors, resolved, pruned };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Pull recent Keka attendance on demand (trailing window). Runs inline; the
 * heavy first-ever backfill is best done via a pnpm script (no serverless time
 * limit). Surfaces any error back to the UI instead of throwing.
 */
export async function syncKekaAttendanceNow(): Promise<KekaAttendanceSyncResult> {
  await requireRole("SUPERUSER");
  try {
    const r = await syncKekaAttendance();
    revalidateTag(KEKA_ATTENDANCE_TAG, "max");
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Pull Keka leave requests on demand (trailing + forward window). Runs inline;
 * surfaces errors to the UI. The authoritative "on leave" source.
 */
export async function syncKekaLeaveNow(): Promise<KekaLeaveSyncResult> {
  await requireRole("SUPERUSER");
  try {
    const r = await syncKekaLeave();
    revalidateTag(KEKA_LEAVE_TAG, "max");
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Manually map a Keka employee to an app user (resolved_via='manual'), or clear
 * the mapping when userId is empty. Mirrors assignGithubAccount.
 */
export async function assignKekaEmployee(
  kekaEmployeeId: string,
  userId: string
): Promise<{ error?: string }> {
  await requireRole("SUPERUSER");

  if (userId) {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return { error: `Unknown user: "${userId}".` };
  }

  await db
    .update(kekaEmployees)
    .set({
      userId: userId || null,
      resolvedVia: userId ? "manual" : null,
      updatedAt: new Date(),
    })
    .where(eq(kekaEmployees.kekaEmployeeId, kekaEmployeeId));

  return {};
}
