// Emails for the review flow: "you've been asked to review" and "a reviewer
// decided". Builders are pure (and escape everything user-supplied); sending
// uses the same Resend settings as the sprint progress emails and never throws,
// so a mail problem cannot fail a commit or a decision.

export type EmailContent = { subject: string; html: string; text: string };

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

type Common = {
  issueKey: string;
  issueSummary: string;
  projectName: string;
  roundLabel: string;
  /** Absolute link to the details page. */
  url: string;
};

function shell(title: string, bodyHtml: string, url: string, cta: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;max-width:560px">
<h2 style="font-size:16px;margin:0 0 12px">${escapeHtml(title)}</h2>
${bodyHtml}
<p style="margin:20px 0"><a href="${escapeHtml(url)}" style="background:#0f766e;color:#fff;padding:9px 14px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(cta)}</a></p>
<p style="color:#6b7280;font-size:12px">Sent by Flux. ${escapeHtml(url)}</p>
</div>`;
}

export function buildAssignedEmail(a: Common & { committerName: string; tcCount: number; notes: string | null; /** Which tabs/rows of the sheet are under review (describeScope). */ scopeText?: string | null }): EmailContent {
  const subject = `Review requested: ${a.issueKey} test cases (${a.roundLabel})`;
  const notes = a.notes ? `<p style="margin:12px 0;padding:8px 12px;background:#f3f4f6;border-radius:6px;white-space:pre-wrap">${escapeHtml(a.notes)}</p>` : "";
  const scope = a.scopeText ? `<p style="margin:12px 0;color:#374151"><strong>Scope:</strong> ${escapeHtml(a.scopeText)}</p>` : "";
  const html = shell(
    "You've been asked to review test cases",
    `<p><strong>${escapeHtml(a.issueKey)}</strong> — ${escapeHtml(a.issueSummary)}<br><span style="color:#6b7280">${escapeHtml(a.projectName)}</span></p>
<p>${escapeHtml(a.committerName)} submitted <strong>${a.tcCount}</strong> test cases (${escapeHtml(a.roundLabel)}) and assigned you as a reviewer.</p>${scope}${notes}`,
    a.url,
    "Review test cases",
  );
  const text = `${a.committerName} submitted ${a.tcCount} test cases for ${a.issueKey} (${a.roundLabel}) and assigned you as a reviewer.\n${a.scopeText ? `\nScope: ${a.scopeText}\n` : ""}${a.notes ? `\nNotes: ${a.notes}\n` : ""}\nReview: ${a.url}`;
  return { subject, html, text };
}

export function buildDecisionEmail(
  a: Common & { reviewerName: string; decision: "approved" | "changes_requested"; comment: string },
): EmailContent {
  const approved = a.decision === "approved";
  const verb = approved ? "approved" : "requested changes to";
  const subject = `${a.issueKey} test cases ${approved ? "approved" : "need changes"} (${a.roundLabel})`;
  const comment = a.comment.trim()
    ? `<p style="margin:12px 0;padding:8px 12px;background:#f3f4f6;border-radius:6px;white-space:pre-wrap">${escapeHtml(a.comment)}</p>`
    : "";
  const html = shell(
    approved ? "Your test cases were approved" : "Changes requested on your test cases",
    `<p><strong>${escapeHtml(a.issueKey)}</strong> — ${escapeHtml(a.issueSummary)}</p>
<p>${escapeHtml(a.reviewerName)} ${verb} ${escapeHtml(a.roundLabel)}.</p>${comment}`,
    a.url,
    "Open test cases",
  );
  const text = `${a.reviewerName} ${verb} ${a.roundLabel} for ${a.issueKey}.\n${a.comment.trim() ? `\n${a.comment.trim()}\n` : ""}\nOpen: ${a.url}`;
  return { subject, html, text };
}

/** Tells an admin the AI review is on hold or struggling. Plain wording: what happened, what it means, what to do. */
export function buildAiAlertEmail(a: { state: "ok" | "degraded" | "paused"; reason: string | null; message: string | null }): EmailContent {
  const paused = a.state === "paused";
  const what =
    a.reason === "quota" ? "its quota or balance is used up"
    : a.reason === "auth" ? "it rejected the API key"
    : "it is failing repeatedly";
  const subject = paused ? "Flux: AI test-case reviews are on hold" : "Flux: the AI review is having trouble";
  const url = `${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/admin/ai-guidelines`;
  const detail = a.message ? `<p style="margin:12px 0;padding:8px 12px;background:#f3f4f6;border-radius:6px">${escapeHtml(a.message)}</p>` : "";
  const html = shell(
    paused ? "AI reviews are on hold" : "The AI review is having trouble",
    `<p>The AI service is not usable because ${escapeHtml(what)}.${paused ? " New submissions are saved without an AI review, and reviewers can still approve." : " Some reviews may not complete."}</p>${detail}<p>${paused ? "Fix the plan or key, then press <strong>Check now</strong> on the AI status page; skipped reviews can be re-run from there." : "Flux keeps trying; the status page shows the latest state."}</p>`,
    url,
    "Open AI status",
  );
  const text = `The AI service is not usable because ${what}.${paused ? " New submissions are saved without an AI review." : ""}${a.message ? `\n${a.message}` : ""}\nStatus: ${url}`;
  return { subject, html, text };
}

export type SendResult = { ok: true } | { ok: false; error: string };

/** Sends via Resend; resolves to a result instead of throwing. Missing config is reported, not fatal. */
export async function sendEmail(to: string[], content: EmailContent): Promise<SendResult> {
  const recipients = [...new Set(to.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (recipients.length === 0) return { ok: false, error: "No recipients" };
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "Email is not configured (RESEND_API_KEY missing)" };
  try {
    const { Resend } = await import("resend");
    const { error } = await new Resend(apiKey).emails.send({
      from: process.env.EMAIL_FROM ?? "Flux <noreply@example.com>",
      to: recipients,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
