"use server";

import { revalidatePath } from "next/cache";
import { eq, or } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { users, jiraIssues, jiraProjects } from "@/lib/db/schema";
import type { UserRole } from "@/lib/auth/types";

export type UpdateRolesResult = {
  error?: string;
  success?: boolean;
};

export async function updateUserRoles(
  updates: { id: string; role: UserRole }[]
): Promise<UpdateRolesResult> {
  const actor = await requireRole("SUPERUSER");

  if (!updates.length) return { success: true };

  // Prevent the acting superuser from demoting themselves
  const selfUpdate = updates.find((u) => u.id === actor.id);
  if (selfUpdate && selfUpdate.role !== "SUPERUSER") {
    return { error: "You cannot change your own role." };
  }

  await Promise.all(
    updates.map(({ id, role }) =>
      db
        .update(users)
        .set({ role, updatedAt: new Date() })
        .where(eq(users.id, id))
    )
  );

  revalidatePath("/admin/users");
  return { success: true };
}

export type SyncJiraEmailResult = {
  error?: string;
  email?: string;
  updated?: number;
};

export async function syncJiraUserEmail(
  accountId: string
): Promise<SyncJiraEmailResult> {
  await requireRole("SUPERUSER");

  // Find a Jira base URL from any project that has issues for this account
  const [projectRow] = await db
    .select({ jiraBaseUrl: jiraProjects.jiraBaseUrl })
    .from(jiraProjects)
    .innerJoin(jiraIssues, eq(jiraIssues.projectId, jiraProjects.id))
    .where(
      or(
        eq(jiraIssues.assigneeAccountId, accountId),
        eq(jiraIssues.reporterAccountId, accountId)
      )
    )
    .limit(1);

  if (!projectRow) {
    return { error: "No Jira project found for this account ID." };
  }

  const baseUrl = projectRow.jiraBaseUrl.replace(/\/$/, "");
  const adminEmail = process.env.JIRA_SITE_ADMIN_EMAIL;
  const adminToken = process.env.JIRA_SITE_ADMIN_TOKEN;

  if (!adminEmail || !adminToken) {
    return { error: "Jira site admin credentials are not configured." };
  }

  const token = Buffer.from(`${adminEmail}:${adminToken}`).toString("base64");
  const res = await fetch(
    `${baseUrl}/rest/api/3/user?accountId=${encodeURIComponent(accountId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${token}`,
        Accept: "application/json",
      },
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { error: `Jira API error (${res.status}): ${body}` };
  }

  const jiraUser = (await res.json()) as {
    emailAddress?: string;
    displayName?: string;
  };

  if (!jiraUser.emailAddress) {
    return { error: "Email is still not visible. The user may need to make their profile public in Jira." };
  }

  const email = jiraUser.emailAddress;
  const name = jiraUser.displayName ?? null;

  // Bulk-update all issues where this account is assignee or reporter with null email
  const [assigneeResult, reporterResult] = await Promise.all([
    db
      .update(jiraIssues)
      .set({ assigneeEmail: email, assigneeName: name ?? undefined })
      .where(
        eq(jiraIssues.assigneeAccountId, accountId)
      ),
    db
      .update(jiraIssues)
      .set({ reporterEmail: email, reporterName: name ?? undefined })
      .where(
        eq(jiraIssues.reporterAccountId, accountId)
      ),
  ]);

  revalidatePath("/admin/users");
  return { email, updated: (assigneeResult.rowCount ?? 0) + (reporterResult.rowCount ?? 0) };
}
