/**
 * A standalone, print-optimised page of the movement checklist. The browser's Print -> Save as PDF
 * makes the PDF (no PDF library is added to the app). Everything interpolated is escaped, there is
 * no script, no external request, and the response carries a strict CSP (`HTML_CSP`) as a second
 * line of defence.
 */
import { formatSources, type Checklist, type ChecklistItem } from "../checklist";
import { escapeHtml as esc } from "@/lib/test-cases/notify";
import { fmtTs, MAX_EXPORT_ROWS } from "./common";
import type { ExportModel } from "./model";

/** No script, font, image or connection of any kind; cannot be framed, cannot change its base URL, cannot post a form. */
export const HTML_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const CSS = `
*{box-sizing:border-box}
body{font:12px/1.45 Arial,Helvetica,sans-serif;color:#111827;margin:24px;max-width:1100px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0 0 8px;color:#0f766e;border-bottom:2px solid #0f766e;padding-bottom:3px;break-after:avoid}
h3{font-size:12px;margin:10px 0 4px;break-after:avoid}
p{margin:4px 0}.muted{color:#6b7280}.hint{background:#f0fdfa;border:1px solid #99f6e4;padding:6px 10px;border-radius:4px;margin:10px 0}
table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #d1d5db;padding:3px 6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{background:#0f766e;color:#fff;font-weight:600}tr{break-inside:avoid}
section{margin:0 0 22px}
ul{margin:4px 0;padding-left:0;list-style:none}li{margin:2px 0;padding:3px 6px;border-left:3px solid #e5e7eb;white-space:pre-wrap;overflow-wrap:anywhere;break-inside:avoid}
li.blocker,tr.blocker td{background:#fee2e2;border-left-color:#dc2626}li.warn,tr.warn td{background:#fef3c7;border-left-color:#d97706}li.conflict,tr.conflict td{background:#fecaca;border-left-color:#b91c1c}li.unknown,tr.unknown td{background:#ffedd5;border-left-color:#ea580c}
.tag{display:inline-block;font-size:10px;font-weight:700;padding:0 5px;border-radius:3px;background:#e5e7eb;margin-right:4px}.tag.bad{background:#dc2626;color:#fff}.tag.mid{background:#d97706;color:#fff}
.src{color:#6b7280;font-size:11px}.env{display:inline-block;margin:0 6px 0 0;padding:0 4px;border-radius:3px;background:#f3f4f6}.env.target{background:#ccfbf1;font-weight:700}.env.unk{background:#fca5a5;color:#7f1d1d;font-weight:700}
@page{size:A4;margin:14mm}
@media print{body{margin:0;max-width:none}.noprint{display:none}section{break-before:page}section.first{break-before:auto}a{color:inherit}}
`;

const td = (s: string | number | null | undefined, cls = "") => `<td${cls ? ` class="${cls}"` : ""}>${esc(String(s ?? ""))}</td>`;
const th = (...cols: string[]) => `<tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;

const sevClass = (it: ChecklistItem): string => (it.conflict ? "conflict" : it.severity === "blocker" ? "blocker" : it.severity === "warn" || it.needsAttention ? "warn" : "");

function flagTags(it: ChecklistItem): string {
  const out: string[] = [];
  if (it.severity && it.severity !== "info") out.push(`<span class="tag ${it.severity === "blocker" ? "bad" : "mid"}">${esc(it.label ?? (it.severity === "blocker" ? "BLOCKER" : "WARN"))}</span>`);
  else if (it.label) out.push(`<span class="tag">${esc(it.label)}</span>`);
  if (it.conflict) out.push(`<span class="tag bad">CONFLICT ${esc(it.conflict.kind)}</span>`);
  if (it.needsAttention) out.push(`<span class="tag mid">NEEDS ATTENTION</span>`);
  return out.join("");
}

function envCells(it: ChecklistItem): string {
  if (!it.env) return "";
  const t = it.env.target;
  return (["demo", "uat", "prod"] as const)
    .map((e) => {
      const v = it.env!.values[e];
      const cls = e === t ? (v === null ? "env unk" : "env target") : "env";
      return `<span class="${cls}">${esc(e.toUpperCase())}${e === t ? " (target)" : ""}: ${esc(v ?? "unknown")}</span>`;
    })
    .join("");
}

function itemHtml(it: ChecklistItem): string {
  const text = it.config
    ? `${it.config.key}${it.config.aliases?.length ? ` (also: ${it.config.aliases.join(", ")})` : ""}${it.config.store ? ` (${it.config.store})` : ""}${it.config.default !== undefined ? `, default ${it.config.default}` : ""}`
    : it.text;
  const src = formatSources(it.sources, it.moreSources);
  const lead = it.seq !== undefined ? `${it.seq}. ` : "";
  return `<li class="${sevClass(it)}">${flagTags(it)}${esc(lead + text)}${it.env ? `<br>${envCells(it)}` : ""}${src ? ` <span class="src">[${esc(src)}]</span>` : ""}</li>`;
}

function checklistBody(cl: Checklist, budget: { left: number; omitted: number }): string {
  const out: string[] = [];
  for (const s of cl.sections) {
    out.push(`<section><h2>${s.number}. ${esc(s.title)}</h2>`);
    if (!s.items.length) out.push(`<p class="muted">(nothing recorded)</p>`);
    else {
      out.push("<ul>");
      for (const it of s.items) {
        if (budget.left <= 0) budget.omitted++;
        else {
          budget.left--;
          out.push(itemHtml(it));
        }
      }
      out.push("</ul>");
    }
    out.push("</section>");
  }
  return out.join("\n");
}

export function renderHtml(model: ExportModel, opts: { maxRows?: number } = {}): string {
  const cl = model.checklist;
  const m = model.movement;
  const budget = { left: opts.maxRows ?? MAX_EXPORT_ROWS, omitted: 0 };
  const title = `Movement to ${m.environment.toUpperCase()}: ${model.delivery.name}`;
  const st = cl.stats;
  const P: string[] = [];
  P.push(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style></head><body>`);
  P.push(`<p class="hint noprint">To get a PDF: use the browser's Print (Ctrl/Cmd+P) and choose "Save as PDF".</p>`);

  P.push(`<section class="first"><h1>${esc(title)}</h1><p class="muted">Delivery date ${esc(model.delivery.date)}. Exported ${esc(fmtTs(model.generatedAt))}. Status: ${esc(m.status)}. Records last refreshed: ${esc(m.refreshedAt ? fmtTs(m.refreshedAt) : "never")}.</p>`);
  P.push(`<p class="muted">Checklist hash ${esc(m.hash)}</p><p>${esc(cl.summary)}</p>`);
  P.push(`<h3>Sign-offs</h3><table>${th("Role", "Person", "State", "When")}`);
  for (const g of model.signers) {
    P.push(`<tr class="${g.signed && g.signedCurrent ? "" : "warn"}">${td(g.slot)}${td(g.name ? `${g.name} <${g.email}>` : g.email)}${td(g.signed ? (g.signedCurrent ? "signed" : "signed an older checklist") : "not signed")}${td(fmtTs(g.signedAt))}</tr>`);
  }
  P.push("</table>");
  P.push(`<h3>Counts</h3><table>${th("Jiras ticked / total / held", "Records / PRs", "Items", "Conflicts", "Unknowns", "Need attention")}<tr>${td(`${st.included} / ${st.jiras} / ${st.held}`)}${td(`${st.records} / ${st.prs}`)}${td(st.items)}${td(st.conflicts, st.conflicts ? "conflict" : "")}${td(st.unknowns, st.unknowns ? "unknown" : "")}${td(st.needsAttention, st.needsAttention ? "warn" : "")}</tr></table></section>`);

  // Jiras
  P.push(`<section><h2>Jiras</h2><table>${th("Jira", "Summary", "In", "Readiness", "Blockers / warnings", "Override", "Dev", "Tester")}`);
  const sign = new Map(cl.signoffs.map((x) => [x.jira, x]));
  const so = (v: { by: string; at: string } | "missing" | undefined) => (v === undefined ? "" : v === "missing" ? "MISSING" : `${v.by} (${fmtTs(v.at)})`);
  for (const it of model.items.slice(0, budget.left)) {
    const x = sign.get(it.key);
    const cls = it.readiness === "blocked" ? "blocker" : it.readiness === "override" || it.warnings.length ? "warn" : "";
    P.push(`<tr class="${cls}">${td(it.key)}${td(it.summary)}${td(it.included ? "yes" : "no")}${td(it.readiness)}<td>${it.warnings.map((w) => esc(w.message)).join("<br>")}</td>${td(it.override ? `${it.override.reason} (${it.override.by ?? ""}, ${fmtTs(it.override.at)})` : "")}${td(so(x?.dev), x?.dev === "missing" ? "warn" : "")}${td(so(x?.tester), x?.tester === "missing" ? "warn" : "")}</tr>`);
  }
  P.push("</table></section>");

  // Conflicts, unknowns, warnings
  if (cl.conflicts.length) {
    P.push(`<section><h2>Conflicts (${cl.conflicts.length})</h2><p class="muted">The records disagree; decide before moving.</p><ul>`);
    for (const c of cl.conflicts) {
      P.push(`<li class="conflict"><span class="tag bad">${esc(c.kind)}</span><strong>${esc(c.title)}</strong>`);
      for (const v of c.variants) P.push(`<br>&bull; ${esc(v.text)}${v.sources.length ? ` <span class="src">[${esc(formatSources(v.sources))}]</span>` : ""}`);
      P.push("</li>");
    }
    P.push("</ul></section>");
  }
  if (cl.unknownsByOwner.length) {
    P.push(`<section><h2>Unknowns to resolve, by owner</h2>`);
    for (const g of cl.unknownsByOwner) {
      P.push(`<h3>${esc(g.owner || "owner not named")} (${g.items.length + (g.more ?? 0)})</h3><ul>`);
      for (const u of g.items) P.push(`<li class="unknown">${esc(u.text)}${u.sources.length ? ` <span class="src">[${esc(formatSources(u.sources, u.moreSources))}]</span>` : ""}</li>`);
      if (g.more) P.push(`<li class="muted">... ${g.more} more not listed</li>`);
      P.push("</ul>");
    }
    P.push("</section>");
  }
  if (cl.warnings.length) {
    P.push(`<section><h2>Warnings</h2><ul>`);
    for (const w of cl.warnings) P.push(`<li class="warn">${esc(w.message)}${w.sources.length ? ` <span class="src">[${esc(formatSources(w.sources))}]</span>` : ""}</li>`);
    P.push("</ul></section>");
  }

  P.push(checklistBody(cl, budget));
  if (budget.omitted > 0) P.push(`<section><p class="hint">${budget.omitted} more rows omitted (the page shows at most ${opts.maxRows ?? MAX_EXPORT_ROWS} checklist items).</p></section>`);

  // Events
  P.push(`<section><h2>Events (last ${model.events.length})</h2><table>${th("When", "Event", "By", "Detail")}`);
  for (const e of model.events) P.push(`<tr>${td(fmtTs(e.at))}${td(e.type)}${td(e.actor)}${td(e.detail)}</tr>`);
  P.push("</table></section></body></html>");
  return P.join("\n");
}
