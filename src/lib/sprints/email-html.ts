// Shared building blocks for the sprint/workstream progress emails — inline,
// table-based styles only, so Outlook and Gmail render them alike.

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
