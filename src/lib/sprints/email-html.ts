// Shared building blocks for the sprint/workstream progress emails — inline,
// table-based styles only, so Outlook and Gmail render them alike.

import { RISK_LABELS, type SprintItemRisk } from "@/lib/sprints/risk";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const PROGRESS_LABELS: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
};

export const PROGRESS_COLORS: Record<string, string> = {
  todo: "#6b7280",
  in_progress: "#1d4ed8",
  done: "#047857",
};

/** One stat tile — table-based so every email client renders it. */
export function tile(label: string, value: string, color = "#111827"): string {
  return `<td style="padding:0 6px 8px 0;">
    <div style="border:1px solid #e5e7eb;border-radius:6px;padding:8px 12px;background:#fafafa;min-width:78px;">
      <div style="font-size:18px;font-weight:700;color:${color};line-height:1.2;">${value}</div>
      <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;margin-top:2px;">${label}</div>
    </div>
  </td>`;
}

/** Table-based progress bar — width styles survive email clients. */
export function bar(pct: number, fill: string): string {
  return `
    <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
      <tr>
        <td style="background:${fill};height:10px;border-radius:6px 0 0 6px;" width="${Math.max(pct, 1)}%"></td>
        <td style="background:#e5e7eb;height:10px;border-radius:${pct >= 100 ? "6px" : "0 6px 6px 0"};" width="${Math.max(100 - pct, 1)}%"></td>
      </tr>
    </table>`;
}

/** Percentage color grading: green when healthy, amber when middling, red when behind. */
export function pctColor(pct: number): string {
  return pct >= 70 ? "#047857" : pct >= 40 ? "#b45309" : "#b91c1c";
}

export function ctaButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#0d9488;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;padding:9px 18px;border-radius:6px;">${label}</a>`;
}

/** The branded outer shell: teal header (title + subtitle line) around the body HTML. */
export function emailShell(title: string, subtitle: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f9fafb;font-family:Segoe UI,Arial,sans-serif;">
  <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <div style="background:#0f766e;color:#ffffff;padding:16px 20px;">
      <div style="font-size:17px;font-weight:700;">${esc(title)}</div>
      <div style="font-size:12px;opacity:.85;margin-top:2px;">${subtitle}</div>
    </div>
    <div style="padding:20px;">${bodyHtml}</div>
  </div>
</body></html>`;
}

export function senderLine(badgeHtml: string, senderName: string): string {
  return `<div style="margin-bottom:12px;">${badgeHtml}<span style="font-size:12px;color:#6b7280;margin-left:8px;">Progress update · sent by ${esc(senderName)} via Flux</span></div>`;
}

export function messageBlock(message: string): string {
  if (!message) return "";
  return `<p style="font-size:13px;color:#111827;border-left:3px solid #0d9488;padding-left:10px;white-space:pre-wrap;margin:0 0 16px;">${esc(message)}</p>`;
}

export function phaseBadge(label: string, kind: "planned" | "active" | "completed"): string {
  const bg = kind === "completed" ? "#d1fae5" : kind === "active" ? "#dbeafe" : "#f4f4f5";
  const fg = kind === "completed" ? "#047857" : kind === "active" ? "#1d4ed8" : "#52525b";
  return `<span style="display:inline-block;background:${bg};color:${fg};border-radius:999px;padding:2px 10px;font-size:11px;font-weight:600;">${label}</span>`;
}

// ---------------------------------------------------------------------------
// Risk highlighting
//
// Same three states the sprint table shows on screen, in the same red/amber/
// zinc family, but as inline hex because email clients drop <style> blocks and
// have no Tailwind. Every risk signal carries its text label as well as its
// colour, so the mail still reads correctly in a client that strips colour and
// for recipients who cannot distinguish red from amber.
// ---------------------------------------------------------------------------

export const RISK_EMAIL_STYLES: Record<
  Exclude<SprintItemRisk, null>,
  { fg: string; bg: string; border: string; row: string }
> = {
  overdue: { fg: "#b91c1c", bg: "#fee2e2", border: "#fecaca", row: "#fef2f2" },
  at_risk: { fg: "#b45309", bg: "#fef3c7", border: "#fde68a", row: "#fffbeb" },
  unplanned: { fg: "#71717a", bg: "#f4f4f5", border: "#e4e4e7", row: "#fafafa" },
};

/** A pill in the given risk's colours, carrying arbitrary text. */
export function riskBadge(risk: Exclude<SprintItemRisk, null>, text: string): string {
  const s = RISK_EMAIL_STYLES[risk];
  return `<span style="display:inline-block;background:${s.bg};color:${s.fg};border:1px solid ${s.border};border-radius:999px;padding:1px 8px;font-size:11px;font-weight:700;white-space:nowrap;">${text}</span>`;
}

/** A colour-plus-label risk badge. Muted "On track" when there is no risk. */
export function riskCell(risk: SprintItemRisk, done: boolean): string {
  if (!risk) {
    return done
      ? `<span style="font-size:11px;color:#a1a1aa;">—</span>`
      : `<span style="font-size:11px;color:#059669;">On track</span>`;
  }
  return riskBadge(risk, RISK_LABELS[risk]);
}

/** A stat tile in a risk colour, for the Overdue / At risk / Unplanned counts. */
export function riskTile(label: string, value: string, risk: Exclude<SprintItemRisk, null>): string {
  const s = RISK_EMAIL_STYLES[risk];
  return `<td style="padding:0 6px 8px 0;">
    <div style="border:1px solid ${s.border};border-radius:6px;padding:8px 12px;background:${s.bg};min-width:78px;">
      <div style="font-size:18px;font-weight:700;color:${s.fg};line-height:1.2;">${value}</div>
      <div style="font-size:10px;color:${s.fg};text-transform:uppercase;letter-spacing:.4px;margin-top:2px;">${label}</div>
    </div>
  </td>`;
}

const CALLOUT_TONES = {
  danger: { accent: "#b91c1c", bg: "#fef2f2", border: "#fecaca", fg: "#991b1b", detail: "#7f1d1d" },
  warn: { accent: "#b45309", bg: "#fffbeb", border: "#fde68a", fg: "#92400e", detail: "#78350f" },
  ok: { accent: "#047857", bg: "#ecfdf5", border: "#a7f3d0", fg: "#065f46", detail: "#064e3b" },
} as const;

/**
 * The banner directly under the sender line — the one thing a stakeholder who
 * reads nothing else will see. `heading` and `detail` are HTML, so callers
 * escape their own interpolations.
 */
export function callout(tone: keyof typeof CALLOUT_TONES, heading: string, detail: string): string {
  const t = CALLOUT_TONES[tone];
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 16px;">
    <tr>
      <td width="4" style="width:4px;background:${t.accent};border-radius:3px 0 0 3px;"></td>
      <td style="background:${t.bg};border:1px solid ${t.border};border-left:0;border-radius:0 6px 6px 0;padding:10px 14px;">
        <div style="font-size:13px;font-weight:700;color:${t.fg};">${heading}</div>
        ${detail ? `<div style="font-size:12px;color:${t.detail};margin-top:3px;line-height:1.5;">${detail}</div>` : ""}
      </td>
    </tr>
  </table>`;
}

/** Spells out what each colour means, so the table needs no explaining. */
export function riskLegend(): string {
  const swatch = (risk: Exclude<SprintItemRisk, null>, meaning: string) => {
    const s = RISK_EMAIL_STYLES[risk];
    return `<span style="display:inline-block;margin-right:14px;white-space:nowrap;">
      <span style="display:inline-block;width:8px;height:8px;background:${s.fg};border-radius:2px;"></span>
      <strong style="color:${s.fg};">${RISK_LABELS[risk]}</strong>
      <span style="color:#6b7280;">${meaning}</span>
    </span>`;
  };
  return `<div style="font-size:11px;color:#6b7280;margin-top:10px;line-height:1.9;">
    ${swatch("overdue", "due date passed")}
    ${swatch("at_risk", "under 20% of planned time left")}
    ${swatch("unplanned", "no start or due date")}
  </div>`;
}

/**
 * Hidden inbox preview text. Gmail and Outlook show this next to the subject in
 * the message list; without it they scrape whatever body text comes first,
 * which here is the sender boilerplate. The trailing filler stops following
 * content leaking into the snippet.
 */
export function preheader(text: string): string {
  return `<div style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f9fafb;">${esc(text)}${"&#8204;&nbsp;".repeat(60)}</div>`;
}
