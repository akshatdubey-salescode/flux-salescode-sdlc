// Guarded "Approve & send" path for the daily client support report.

import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects, users } from "@/lib/db/schema";
import { ConflictError, isSendEnabled } from "./approval";
import { approverNoticeEmail, renderSupportReportEmail } from "./render-email";
import { claimForSending, getReport, getSettings, markFailed, markSent, NotFoundError } from "./store";

export { ConflictError, approvalBlocker, canApproveReports, isSendEnabled } from "./approval";

async function sendViaResend(args: {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
}): Promise<string | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Email is not configured (RESEND_API_KEY missing)");
  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM ?? "Flux <noreply@example.com>",
    to: args.to,
    ...(args.cc && args.cc.length > 0 ? { cc: args.cc } : {}),
    subject: args.subject,
    html: args.html,
  });
  if (error) throw new Error(error.message ?? "Email send failed");
  return data?.id ?? null;
}

export async function approveAndSend(
  reportId: string,
  approver: { id: string; name: string },
  expectedBuiltAt: Date,
): Promise<{ status: "sent" } | { status: "failed"; error: string }> {
  if (!isSendEnabled()) throw new ConflictError("Sending is disabled in this environment");
  const report = await getReport(reportId);
  if (!report) throw new NotFoundError("Report not found");
  const settings = await getSettings(report.projectId);

  const data = await claimForSending(reportId, expectedBuiltAt);
  if (!data) {
    throw new ConflictError("Report changed or is already being sent — reload and review again");
  }

  // Phase 1: anything failing before Resend accepts the mail is a clean failure.
  let messageId: string | null;
  try {
    const { subject, html } = renderSupportReportEmail(data);
    messageId = await sendViaResend({
      to: settings.toEmails,
      cc: settings.ccEmails,
      subject,
      html,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    try {
      await markFailed(reportId, { approvedBy: approver.id, approvedByName: approver.name, error });
    } catch (markErr) {
      console.error("[support-report] markFailed failed", { reportId, markErr });
    }
    return { status: "failed", error };
  }

  // Phase 2: the mail is out. Never move to 'failed' (that would allow a resend).
  const sent = {
    approvedBy: approver.id,
    approvedByName: approver.name,
    to: settings.toEmails,
    cc: settings.ccEmails,
    messageId,
  };
  try {
    await markSent(reportId, sent);
  } catch {
    try {
      await markSent(reportId, sent);
    } catch (err) {
      console.error(
        "[support-report] EMAIL SENT but markSent failed; row left in 'sending' to block resends",
        { reportId, messageId, err },
      );
    }
  }
  return { status: "sent" };
}

export async function notifyApprovers(
  projectId: string,
  reportDate: string,
  reportId: string,
  appUrl: string,
): Promise<void> {
  if (!isSendEnabled()) return;
  try {
    const [settings, report, [project]] = await Promise.all([
      getSettings(projectId),
      getReport(reportId),
      db.select({ name: jiraProjects.name }).from(jiraProjects).where(eq(jiraProjects.id, projectId)).limit(1),
    ]);
    if (settings.approverUserIds.length === 0) return;
    const rows = await db
      .select({ email: users.email })
      .from(users)
      .where(inArray(users.id, settings.approverUserIds));
    const to = rows.map((r) => r.email);
    if (to.length === 0) return;

    const { subject, html } = approverNoticeEmail({
      projectName: project?.name ?? report?.data.projectName ?? "Project",
      reportDate,
      reviewUrl: `${appUrl}/projects/${projectId}?tab=support&view=reports`,
      uncategorisedCount: report?.data.uncategorised.length ?? 0,
    });
    await sendViaResend({ to, subject, html });
  } catch (e) {
    console.error("[support-report] notifyApprovers failed", e);
  }
}
