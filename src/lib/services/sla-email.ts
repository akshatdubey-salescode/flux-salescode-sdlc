import { db } from "@/lib/db";
import { emailNotifications, slaViolations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { ViolationResult } from "./sla-detection";

// ---------------------------------------------------------------------------
// Provider interface — swap Resend for any other provider without changing call sites
// ---------------------------------------------------------------------------

interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

interface EmailProvider {
  send(msg: EmailMessage): Promise<void>;
}

function buildResendProvider(): EmailProvider {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");

  return {
    async send(msg) {
      const { Resend } = await import("resend");
      const client = new Resend(apiKey);
      const { error } = await client.emails.send({
        from: process.env.EMAIL_FROM ?? "SLA Engine <noreply@example.com>",
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
      });
      if (error) throw new Error(error.message);
    },
  };
}

function getProvider(): EmailProvider {
  return buildResendProvider();
}

// ---------------------------------------------------------------------------
// Email HTML builder
// ---------------------------------------------------------------------------

type DigestRow = {
  violation: ViolationResult;
  violationDbId: string | undefined; // set after insert for new violations
};

function formatHours(hours: number): string {
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  const days = Math.floor(hours / 24);
  const rem = Math.round((hours % 24) * 10) / 10;
  return rem === 0 ? `${days}d` : `${days}d ${rem}h`;
}

function pctOver(elapsed: number, threshold: number): string {
  const pct = ((elapsed - threshold) / threshold) * 100;
  return `${Math.round(pct)}%`;
}

function buildDigestHtml(
  projectName: string,
  rows: ViolationResult[],
  isEscalation: boolean
): string {
  const sorted = [...rows].sort((a, b) => (a.tier > b.tier ? -1 : 1));

  const rowsHtml = sorted
    .map((r) => {
      const badge =
        r.tier === 2
          ? `<span style="background:#dc2626;color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700">ESCALATION</span>`
          : `<span style="background:#f59e0b;color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700">BREACHED</span>`;

      const threshold = parseFloat(r.rule.thresholdHours);
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:13px">${r.issue.jiraKey}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">${r.issue.summary}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">${r.rule.name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;white-space:nowrap">${formatHours(r.elapsedHours)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;white-space:nowrap">${formatHours(threshold)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;white-space:nowrap">${pctOver(r.elapsedHours, threshold)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${badge}</td>
        </tr>`;
    })
    .join("");

  const title = isEscalation
    ? `[ESCALATION] ${projectName} — ${rows.length} SLA violation(s) need your attention`
    : `[SLA Violation] ${projectName} — ${rows.length} issue(s) stuck`;

  return `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#f9fafb;margin:0;padding:24px">
  <div style="max-width:800px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden">
    <div style="background:${isEscalation ? "#dc2626" : "#f59e0b"};padding:20px 24px">
      <h1 style="margin:0;color:#fff;font-size:18px">${title}</h1>
    </div>
    <div style="padding:24px">
      <p style="color:#374151;font-size:14px;margin-top:0">
        The following issues have exceeded their SLA thresholds and require attention.
      </p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb">Jira Key</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb">Summary</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb">Rule</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb">Time Elapsed</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb">Threshold</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb">% Over</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb">Status</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb">
      <p style="margin:0;font-size:12px;color:#9ca3af">Sent by SLA Engine • Do not reply to this email</p>
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Digest sender — one email per recipient per run
// ---------------------------------------------------------------------------

export type DigestRecipient = {
  email: string;
  violations: ViolationResult[];
  /** Map from violation key (ruleId+issueId) to the DB violation row id */
  violationIds: Map<string, string>;
};

/**
 * Sends one digest email per recipient. On success:
 * - Updates sla_violations.notificationSentAt / escalationNotifiedAt
 * - Inserts into email_notifications audit table
 */
export async function sendSLADigestEmail(
  projectName: string,
  recipient: DigestRecipient
): Promise<{ sent: boolean; error?: string }> {
  const provider = getProvider();
  const { email, violations } = recipient;

  const hasEscalation = violations.some((v) => v.tier === 2);
  const subject = hasEscalation
    ? `[ESCALATION] ${projectName} — ${violations.length} SLA violation(s) need your attention`
    : `[SLA Violation] ${projectName} — ${violations.length} issue(s) stuck`;

  const html = buildDigestHtml(projectName, violations, hasEscalation);

  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await provider.send({ to: email, subject, html });
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  if (lastErr !== undefined) {
    const err = lastErr;
    const errorMessage = err instanceof Error ? err.message : String(err);
    // Audit each violation attempt as failed
    for (const v of violations) {
      const violationDbId = v.existingViolationId ?? recipient.violationIds.get(`${v.rule.id}:${v.issue.id}`);
      if (violationDbId) {
        await db.insert(emailNotifications).values({
          slaViolationId: violationDbId,
          recipientEmail: email,
          subject,
          status: "failed",
          errorMessage,
          sentAt: new Date(),
        });
      }
    }
    return { sent: false, error: errorMessage };
  }

  const sentAt = new Date();

  // Update violation rows and insert audit records
  for (const v of violations) {
    const violationDbId = v.existingViolationId ?? recipient.violationIds.get(`${v.rule.id}:${v.issue.id}`);
    if (!violationDbId) continue;

    if (v.tier === 1) {
      await db
        .update(slaViolations)
        .set({ notificationSentAt: sentAt, notificationStatus: "sent" })
        .where(eq(slaViolations.id, violationDbId));
    } else {
      await db
        .update(slaViolations)
        .set({ escalationNotifiedAt: sentAt })
        .where(eq(slaViolations.id, violationDbId));
    }

    await db.insert(emailNotifications).values({
      slaViolationId: violationDbId,
      recipientEmail: email,
      subject,
      status: "sent",
      sentAt,
    });
  }

  return { sent: true };
}
