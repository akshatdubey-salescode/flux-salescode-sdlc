"use server";

import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { kekaEmployees, users } from "@/lib/db/schema";
import { syncKekaEmployees } from "@/lib/keka/sync";

export type KekaSyncResult =
  | { ok: true; synced: number; errors: number; resolved: number; pruned: number }
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
    return { ok: true, synced, errors, resolved, pruned };
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
