// Builds (or rebuilds) the stored support report for one project and IST day.
//
// Every build path (cron, "Build now", Rebuild) first lapses the project's
// older awaiting/failed reports, so only one day's report is ever approvable.
// Building never notifies approvers; only the 17:00 cron does that.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { buildReportData } from "./aggregate";
import {
  getSettings,
  lapseOlderAwaiting,
  listSupportTickets,
  NotFoundError,
  upsertAwaitingReport,
} from "./store";
import { reportWindow } from "./windows";

export async function buildSupportReport(
  projectId: string,
  reportDate: string,
  by: { id: string; name: string } | null,
): Promise<
  { id: string; created: boolean; lapsed: number } | { blocked: "already_final"; lapsed: number }
> {
  const [project] = await db
    .select({ name: jiraProjects.name })
    .from(jiraProjects)
    .where(eq(jiraProjects.id, projectId))
    .limit(1);
  if (!project) throw new NotFoundError("Project not found");

  const lapsed = await lapseOlderAwaiting(projectId, reportDate);

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

  const result = await upsertAwaitingReport(projectId, reportDate, data, by);
  return { ...result, lapsed };
}
