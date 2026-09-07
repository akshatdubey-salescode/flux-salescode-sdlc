import type { SprintWithItems } from "@/lib/sprints/entries";
import { buildSprintWorkbook } from "@/lib/sprints/report";
import { buildSprintEmail } from "@/lib/sprints/email-progress";

/**
 * The one code path that actually mails a sprint's progress.
 *
 * Extracted from the POST route so the manual "send now" button and the
 * midnight scheduler are the same code rather than two implementations that
 * drift: the whole promise of the compose dialog's Preview tab is that what
 * recipients get is what was rendered, and a scheduled send has to keep that
 * promise months later. Routes are left with auth, validation and delivery of
 * the HTTP response; this owns the email.
 */

/**
 * Resend accepts at most 50 addresses in one `to`, and the product cap has
 * always been lower. Recipient lists are chunked against THIS number rather
 * than the product cap so raising the cap can't quietly start failing sends.
 */
const MAX_TO_PER_CALL = 25;

/** The product cap, enforced by every route that accepts a recipient list. */
export const MAX_RECIPIENTS = 25;

export const MAX_SUBJECT = 200;
export const MAX_MESSAGE = 4000;

export type SprintEmailSend = {
  sprint: SprintWithItems;
  recipients: string[];
  /** Blank falls back to the builder's own live-risk subject. */
  subject?: string;
  message: string;
  /** Whose name appears in "sent by … via Flux". */
  senderName: string;
  /** Origin for the "Open in Flux" deep link, no trailing slash. */
  appUrl: string;
};

export type SprintEmailSent = {
  subject: string;
  recipientCount: number;
  /** Resend's id per chunk sent — the handle for asking about delivery later. */
  messageIds: string[];
};

/**
 * Builds the email + workbook and sends it. Throws on a misconfigured or
 * failing transport — the manual route turns that into a 502/503, the
 * scheduler records it on the run row.
 */
export async function sendSprintProgressEmail({
  sprint,
  recipients,
  subject,
  message,
  senderName,
  appUrl,
}: SprintEmailSend): Promise<SprintEmailSent> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Email is not configured (RESEND_API_KEY missing)");
  if (recipients.length === 0) throw new Error("No recipients");

  const sprintUrl = `${appUrl}/sprints/${sprint.id}`;
  const built = buildSprintEmail(sprint, message, senderName, sprintUrl);
  const finalSubject = subject?.trim() || built.subject;

  // Built once and reused across chunks — it's the same report either way.
  const workbook = await buildSprintWorkbook([sprint]);
  const safeName = sprint.name.replace(/[^\w-]+/g, "_");

  const { Resend } = await import("resend");
  const client = new Resend(apiKey);

  const messageIds: string[] = [];
  for (let i = 0; i < recipients.length; i += MAX_TO_PER_CALL) {
    const chunk = recipients.slice(i, i + MAX_TO_PER_CALL);
    const { data, error } = await client.emails.send({
      from: process.env.EMAIL_FROM ?? "Flux <noreply@example.com>",
      to: chunk,
      subject: finalSubject,
      html: built.html,
      attachments: [{ filename: `${safeName}-report.xlsx`, content: Buffer.from(workbook) }],
    });
    if (error) throw new Error(`Email failed: ${error.message}`);
    if (data?.id) messageIds.push(data.id);
  }

  return { subject: finalSubject, recipientCount: recipients.length, messageIds };
}

/** Renders the subject + HTML a send would produce, without sending. */
export function previewSprintProgressEmail({
  sprint,
  subject,
  message,
  senderName,
  appUrl,
}: Omit<SprintEmailSend, "recipients">): { subject: string; html: string } {
  const built = buildSprintEmail(sprint, message, senderName, `${appUrl}/sprints/${sprint.id}`);
  return { subject: subject?.trim() || built.subject, html: built.html };
}
