"use server";

import { revalidatePath } from "next/cache";
import { eq, and, ne } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";

export type SetFreshdeskState = { error?: string; ok?: boolean };

// Set (or clear, when companyId is empty) the Freshdesk company ID for a project.
// This is the single switch that enables Client Issue Tracking for a project:
// a non-null company ID turns the tab and sync on; clearing it turns them off.
export async function setFreshdeskCompanyId(
  projectId: string,
  rawCompanyId: string
): Promise<SetFreshdeskState> {
  await requireRole("SUPERUSER");

  const companyId = rawCompanyId.trim();

  // Empty → disable the integration for this project.
  if (companyId === "") {
    await db
      .update(jiraProjects)
      .set({ freshdeskCompanyId: null, updatedAt: new Date() })
      .where(eq(jiraProjects.id, projectId));
    revalidatePath("/superuser/freshdesk");
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  }

  // Freshdesk company IDs are numeric.
  if (!/^\d+$/.test(companyId)) {
    return { error: "Company ID must be numeric (digits only)." };
  }

  // Guard against the same company being mapped to two projects — otherwise the
  // same tickets would sync into both.
  const [clash] = await db
    .select({ id: jiraProjects.id, name: jiraProjects.name })
    .from(jiraProjects)
    .where(
      and(
        eq(jiraProjects.freshdeskCompanyId, companyId),
        ne(jiraProjects.id, projectId)
      )
    )
    .limit(1);

  if (clash) {
    return {
      error: `Company ID ${companyId} is already mapped to "${clash.name}".`,
    };
  }

  const updated = await db
    .update(jiraProjects)
    .set({ freshdeskCompanyId: companyId, updatedAt: new Date() })
    .where(eq(jiraProjects.id, projectId))
    .returning({ id: jiraProjects.id });

  if (updated.length === 0) {
    return { error: "Project not found." };
  }

  revalidatePath("/superuser/freshdesk");
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}
