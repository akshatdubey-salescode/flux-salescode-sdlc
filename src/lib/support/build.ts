// Builds (or rebuilds) the stored support report for one project and day (a
// calendar day in the project's timezone).
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
import { buildYtdRows } from "./ytd";
import { renderSubject } from "./subject";

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
  // Year-to-date snapshot for the Excel attachment, independent of the period
  // setting (user decision, 2026-11-20).
  data.ytdTickets = buildYtdRows(tickets, reportDate, settings.officeHours);
  data.timeZone = settings.officeHours.timeZone;
  // Client name and subject are fixed at build time so the mail sent is the
  // one previewed (user decision, 2026-11-25).
  data.clientName = settings.clientName || project.name;
  data.subject = renderSubject(settings.subjectTemplate, {
    client: data.clientName,
    project: project.name,
    period: data.periodLabel,
    reportDate,
  });

  const result = await upsertAwaitingReport(projectId, reportDate, data, by);
  return { ...result, lapsed };
}
