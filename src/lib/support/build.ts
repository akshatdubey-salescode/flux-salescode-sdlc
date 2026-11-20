// Builds (or rebuilds) the stored support report for one project and IST day.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { buildReportData } from "./aggregate";
import { getSettings, listSupportTickets, NotFoundError, upsertAwaitingReport } from "./store";
import { reportWindow } from "./windows";

export async function buildSupportReport(
  projectId: string,
  reportDate: string,
  by: { id: string; name: string } | null,
): Promise<{ id: string; created: boolean } | { blocked: "already_final" }> {
  const [project] = await db
    .select({ name: jiraProjects.name })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, projectId))
    .limit(1);
  if (!project) throw new NotFoundError("Project not found");

  const [settings, tickets] = await Promise.all([
    getSettings(projectId),
    listSupportTickets(projectId),
  ]);

  const data = buildReportData({
    projectName: project.name,
    reportDate,
    sharedBy: settings.sharedBy,
    window: reportWindow(reportDate, settings.periodMode, settings.periodStart),
    sla: settings.sla,
    officeHours: settings.officeHours,
    tickets,
    now: new Date(),
  });

  return upsertAwaitingReport(projectId, reportDate, data, by);
}
