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
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDuration(hours: number): string {
  const totalMins = Math.round(hours * 60);
  if (totalMins < 60) return `${totalMins} min${totalMins !== 1 ? "s" : ""}`;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h < 24) {
    return m === 0
      ? `${h} hr${h !== 1 ? "s" : ""}`
      : `${h} hr${h !== 1 ? "s" : ""} ${m} min`;
  }
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh === 0
    ? `${d} day${d !== 1 ? "s" : ""}`
    : `${d} day${d !== 1 ? "s" : ""} ${rh} hr${rh !== 1 ? "s" : ""}`;
}

// ---------------------------------------------------------------------------
// Email HTML builder
// ---------------------------------------------------------------------------

function buildDigestHtml(
  projectName: string,
  rows: ViolationResult[],
  isEscalation: boolean,
  jiraBaseUrl: string
): string {
  const sorted = [...rows].sort((a, b) => (a.tier > b.tier ? -1 : 1));

  const headerColor = isEscalation ? "#c0392b" : "#e67e22";
  const headerLabel = isEscalation ? "ESCALATION ALERT" : "SLA BREACH ALERT";

  const cardsHtml = sorted
    .map((r) => {
      const threshold = parseFloat(r.rule.thresholdHours);
      const delay = Math.max(0, r.elapsedHours - threshold);
      const jiraUrl = `${jiraBaseUrl.replace(/\/$/, "")}/browse/${r.issue.jiraKey}`;

      const assignee = r.issue.assigneeName?.trim() || "Unassigned";
      const isUnassigned = !r.issue.assigneeName?.trim();

      const tierBadge =
        r.tier === 2
          ? `<span style="display:inline-block;background:#c0392b;color:#fff;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;letter-spacing:0.5px">ESCALATION</span>`
          : `<span style="display:inline-block;background:#e67e22;color:#fff;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;letter-spacing:0.5px">BREACHED</span>`;

      const cardBorderColor = r.tier === 2 ? "#c0392b" : "#e67e22";

      return `
<div style="background:#ffffff;border:1px solid #dfe1e6;border-left:4px solid ${cardBorderColor};border-radius:6px;margin-bottom:16px;overflow:hidden">

  <!-- Card top: key + badge -->
  <table style="width:100%;border-collapse:collapse">
    <tr>
      <td style="padding:16px 20px">
        <table style="border-collapse:collapse">
          <tr>
            <td style="padding:0 10px 0 0">
              <span style="font-family:monospace;font-size:13px;font-weight:700;color:#0052cc;background:#deebff;padding:4px 9px;border-radius:4px">${r.issue.jiraKey}</span>
            </td>
            <td style="padding:0">
              ${tierBadge}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- Summary -->
  <div style="padding:0 20px 16px">
    <p style="margin:0 0 4px;font-size:16px;font-weight:600;color:#172b4d;line-height:1.4">${r.issue.summary}</p>
    <p style="margin:0;font-size:12px;color:#6b778c">SLA Rule: <strong style="color:#42526e">${r.rule.name}</strong></p>
  </div>

  <!-- Divider -->
  <div style="border-top:1px solid #f4f5f7"></div>

  <!-- Time metrics -->
  <div style="padding:16px 20px">
    <table style="border-collapse:collapse;width:100%">
      <tr>
        <td style="padding:0 32px 0 0;vertical-align:top">
          <div style="font-size:10px;font-weight:600;color:#97a0af;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px">Threshold Time</div>
          <div style="font-size:16px;font-weight:600;color:#42526e">${formatDuration(threshold)}</div>
        </td>
        <td style="padding:0 32px 0 0;vertical-align:top">
          <div style="font-size:10px;font-weight:600;color:#97a0af;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px">Time Elapsed</div>
          <div style="font-size:16px;font-weight:600;color:#42526e">${formatDuration(r.elapsedHours)}</div>
        </td>
        <td style="padding:0;vertical-align:top">
          <div style="font-size:10px;font-weight:600;color:#97a0af;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px">Delay</div>
          <div style="font-size:16px;font-weight:700;color:#c0392b">${formatDuration(delay)} late</div>
        </td>
      </tr>
    </table>
  </div>

  <!-- Divider -->
  <div style="border-top:1px solid #f4f5f7"></div>

  <!-- Assignee + CTA -->
  <div style="padding:14px 20px">
    <table style="border-collapse:collapse;width:100%">
      <tr>
        <td style="vertical-align:middle">
          <span style="font-size:12px;color:#6b778c">Assigned to&nbsp;</span>
          <span style="font-size:13px;font-weight:600;color:${isUnassigned ? "#97a0af" : "#172b4d"}">${assignee}</span>
        </td>
        <td style="text-align:right;vertical-align:middle">
          <a href="${jiraUrl}" style="display:inline-block;background:#0052cc;color:#ffffff;padding:9px 18px;border-radius:4px;text-decoration:none;font-size:13px;font-weight:600">Open in Jira &rarr;</a>
        </td>
      </tr>
    </table>
  </div>

</div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#f4f5f7;margin:0;padding:32px 16px">
<div style="max-width:620px;margin:0 auto">

  <!-- Header -->
  <div style="background:${headerColor};border-radius:8px 8px 0 0;padding:28px 32px">
    <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.75);letter-spacing:1px;text-transform:uppercase;margin-bottom:10px">${headerLabel}</div>
    <div style="font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;margin-bottom:6px">${projectName}</div>
    <div style="font-size:14px;color:rgba(255,255,255,0.88)">${sorted.length} issue${sorted.length !== 1 ? "s" : ""} ${isEscalation ? "urgently require" : "require"} your attention</div>
  </div>

  <!-- Body -->
  <div style="background:#f4f5f7;padding:20px 0">
    ${cardsHtml}
  </div>

  <!-- Footer -->
  <div style="padding:12px 0 24px;text-align:center">
    <p style="margin:0;font-size:12px;color:#97a0af">Sent by SLA Engine &bull; Do not reply to this email</p>
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
  recipient: DigestRecipient,
  jiraBaseUrl: string
): Promise<{ sent: boolean; error?: string }> {
  const provider = getProvider();
  const { email, violations } = recipient;

  const hasEscalation = violations.some((v) => v.tier === 2);
  const subject = hasEscalation
    ? `[Escalation] ${projectName} — ${violations.length} SLA violation${violations.length !== 1 ? "s" : ""} need urgent attention`
    : `[SLA Breach] ${projectName} — ${violations.length} issue${violations.length !== 1 ? "s" : ""} need${violations.length === 1 ? "s" : ""} attention`;

  const html = buildDigestHtml(projectName, violations, hasEscalation, jiraBaseUrl);

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
