// Discover emails: comment notifications and take-down notices. Builders are
// pure and escape everything user-supplied; sending reuses the Test Cases
// Resend helper, which never throws.

import { escapeHtml, type EmailContent } from "@/lib/test-cases/notify";

export { sendEmail } from "@/lib/test-cases/notify";

function shell(title: string, bodyHtml: string, url: string, cta: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;max-width:560px">
<h2 style="font-size:16px;margin:0 0 12px">${escapeHtml(title)}</h2>
${bodyHtml}
<p style="margin:20px 0"><a href="${escapeHtml(url)}" style="background:#0f766e;color:#fff;padding:9px 14px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(cta)}</a></p>
<p style="color:#6b7280;font-size:12px">Sent by Flux Discover. ${escapeHtml(url)}</p>
</div>`;
}

const quote = (s: string) =>
  `<p style="margin:12px 0;padding:8px 12px;background:#f3f4f6;border-radius:6px;white-space:pre-wrap">${escapeHtml(s)}</p>`;

const excerpt = (s: string, n = 600) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

export function buildCommentEmail(a: {
  actorName: string;
  showcaseTitle: string;
  commentBody: string;
  isReply: boolean;
  /** True when the recipient wrote the comment being replied to. */
  recipientIsParentAuthor: boolean;
  url: string;
}): EmailContent {
  const what = a.isReply
    ? a.recipientIsParentAuthor
      ? `replied to your comment on`
      : `replied to a comment on your showcase`
    : `commented on your showcase`;
  const subject = `${a.actorName} ${what} "${a.showcaseTitle}"`;
  const body = excerpt(a.commentBody.trim());
  const html = shell(
    a.isReply ? "New reply" : "New comment",
    `<p>${escapeHtml(a.actorName)} ${escapeHtml(what)} <strong>${escapeHtml(a.showcaseTitle)}</strong>.</p>${quote(body)}`,
    a.url,
    "View on Discover",
  );
  const text = `${a.actorName} ${what} "${a.showcaseTitle}":\n\n${body}\n\nView: ${a.url}`;
  return { subject, html, text };
}

export function buildTakedownEmail(a: { showcaseTitle: string; reason: string; url: string }): EmailContent {
  const subject = `Your showcase "${a.showcaseTitle}" was taken down`;
  const html = shell(
    "Your showcase was taken down",
    `<p>An admin unpublished <strong>${escapeHtml(a.showcaseTitle)}</strong> from Discover. It is back in your drafts, nothing was deleted.</p>
<p><strong>Reason:</strong></p>${quote(a.reason)}
<p>You can edit it to address this and publish it again.</p>`,
    a.url,
    "Open your showcase",
  );
  const text = `An admin unpublished "${a.showcaseTitle}" from Discover. It is back in your drafts.\n\nReason: ${a.reason}\n\nYou can edit it and publish again: ${a.url}`;
  return { subject, html, text };
}
