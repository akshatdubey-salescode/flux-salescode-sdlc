import type { SprintWithItems } from "@/lib/sprints/entries";
import { buildSprintWorkbook } from "@/lib/sprints/report";
import { buildSprintEmail, buildWorkstreamEmail } from "@/lib/sprints/email-progress";

/**
 * The one code path that actually mails sprint-tracker progress — a single
 * sprint, or a whole workstream.
 *
 * Extracted from the POST routes so the manual "send now" button and the
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

export type ProgressEmailSent = {
  subject: string;
  recipientCount: number;
  /** Resend's id per chunk sent — the handle for asking about delivery later. */
  messageIds: string[];
};

/**
 * The transport, shared by both senders: one built email plus one workbook,
 * out to the recipient list in chunks Resend will accept.
 *
 * Throws on a misconfigured or failing transport — the manual routes turn that
 * into a 502/503, the scheduler records it on the run row.
 */
async function deliver({
  recipients,
  subject,
  html,
  filename,
  workbook,
}: {
  recipients: string[];
  subject: string;
  html: string;
  filename: string;
  workbook: ArrayBuffer;
}): Promise<ProgressEmailSent> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Email is not configured (RESEND_API_KEY missing)");
  if (recipients.length === 0) throw new Error("No recipients");

  const { Resend } = await import("resend");
  const client = new Resend(apiKey);

  const messageIds: string[] = [];
  for (let i = 0; i < recipients.length; i += MAX_TO_PER_CALL) {
    const chunk = recipients.slice(i, i + MAX_TO_PER_CALL);
    const { data, error } = await client.emails.send({
      from: process.env.EMAIL_FROM ?? "Flux <noreply@example.com>",
      to: chunk,
      subject,
      html,
      attachments: [{ filename, content: Buffer.from(workbook) }],
    });
    if (error) throw new Error(`Email failed: ${error.message}`);
    if (data?.id) messageIds.push(data.id);
  }

  return { subject, recipientCount: recipients.length, messageIds };
}

/** Report filenames carry the entity's name, so they have to survive it. */
function safeName(name: string): string {
  return name.replace(/[^\w-]+/g, "_");
}

// ---------------------------------------------------------------------------
// One sprint
// ---------------------------------------------------------------------------

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

/** Kept as a name of its own — it was the published type before workstreams. */
export type SprintEmailSent = ProgressEmailSent;

/** Builds the email + workbook for one sprint and sends it. */
export async function sendSprintProgressEmail({
  sprint,
  recipients,
  subject,
  message,
  senderName,
  appUrl,
}: SprintEmailSend): Promise<SprintEmailSent> {
  const built = buildSprintEmail(sprint, message, senderName, `${appUrl}/sprints/${sprint.id}`);

  return deliver({
    recipients,
    subject: subject?.trim() || built.subject,
    html: built.html,
    filename: `${safeName(sprint.name)}-report.xlsx`,
    // Built once and reused across chunks — it's the same report either way.
    workbook: await buildSprintWorkbook([sprint]),
  });
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

// ---------------------------------------------------------------------------
// A whole workstream — the initiative altitude: cross-sprint stat tiles and
// bars, a per-sprint breakdown, and the combined multi-sprint workbook.
// ---------------------------------------------------------------------------

export type WorkstreamEmailSend = {
  workstream: { id: string; name: string; description: string | null };
  /** Every live sprint in the workstream, as the email and report render them. */
  sprints: SprintWithItems[];
  recipients: string[];
  subject?: string;
  message: string;
  senderName: string;
  appUrl: string;
};

/** The builder's positional signature, called the one way both paths need. */
function buildWorkstream({
  workstream,
  sprints,
  message,
  senderName,
  appUrl,
}: Omit<WorkstreamEmailSend, "recipients" | "subject">) {
  return buildWorkstreamEmail(
    workstream.name,
    workstream.description,
    sprints,
    message,
    senderName,
    `${appUrl}/workstreams/${workstream.id}`,
    appUrl
  );
}

export async function sendWorkstreamProgressEmail({
  workstream,
  sprints,
  recipients,
  subject,
  message,
  senderName,
  appUrl,
}: WorkstreamEmailSend): Promise<ProgressEmailSent> {
  const built = buildWorkstream({ workstream, sprints, message, senderName, appUrl });

  return deliver({
    recipients,
    subject: subject?.trim() || built.subject,
    html: built.html,
    filename: `${safeName(workstream.name)}-workstream-report.xlsx`,
    workbook: await buildSprintWorkbook(sprints),
  });
}

/** Renders the subject + HTML a workstream send would produce, without sending. */
export function previewWorkstreamProgressEmail({
  workstream,
  sprints,
  subject,
  message,
  senderName,
  appUrl,
}: Omit<WorkstreamEmailSend, "recipients">): { subject: string; html: string } {
  const built = buildWorkstream({ workstream, sprints, message, senderName, appUrl });
  return { subject: subject?.trim() || built.subject, html: built.html };
}
