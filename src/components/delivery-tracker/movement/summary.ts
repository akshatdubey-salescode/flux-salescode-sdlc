/**
 * Pure helpers of the Checklist tab's SUMMARY (the "union" of every Jira): the order of the at-a-glance cards, the status line and what its button
 * says, the stats strip, the plain-text copy. The deterministic rollup (always available) is shown at once; an AI-written summary replaces its wording
 * only when the server marks it fresh.
 */
import type { Badge, Glance, MergedSummary, Rollup, RollupEntry, RollupSection, SummaryView } from "./api-types";
import { cleanNoise, isEmptyPlain, makeDeduper, plainify, plainLines, type Deduper, type Plain } from "./plain-text";
import type { StateKind } from "./rich-text";
import { formatIst, type Tone } from "./view-model";

const SEV_RANK: Record<string, number> = { blocker: 0, warn: 1, info: 2 };

/** Blockers first, then warnings, then information; the order the server delivered is kept inside each group. */
export function orderGlance(glance: readonly Glance[]): Glance[] {
  return glance.map((g, i) => ({ g, i })).sort((a, b) => (SEV_RANK[a.g.severity] ?? 3) - (SEV_RANK[b.g.severity] ?? 3) || a.i - b.i).map((x) => x.g);
}

/** The bar colour of a glance card. */
export const SEVERITY_BAR: Record<string, string> = {
  blocker: "bg-red-500 dark:bg-red-500",
  warn: "bg-amber-500 dark:bg-amber-500",
  info: "bg-sky-400 dark:bg-sky-500",
};

/** How a badge looks: the state words use the same fonts and colours as everywhere else; REQUIRED / ATTENTION / INFO have their own chips. */
export function badgeLook(b: Badge): { kind: "state"; state: StateKind } | { kind: "chip"; tone: Tone } {
  switch (b) {
    case "DONE":
      return { kind: "state", state: "done" };
    case "NOT DONE":
      return { kind: "state", state: "notdone" };
    case "NOT REQUIRED":
      return { kind: "state", state: "na" };
    case "YES":
    case "NO":
      return { kind: "state", state: "yesno" };
    case "UNKNOWN":
      return { kind: "state", state: "unknown" };
    case "REQUIRED":
      return { kind: "chip", tone: "warn" };
    case "ATTENTION":
      return { kind: "chip", tone: "danger" };
    default:
      return { kind: "chip", tone: "muted" };
  }
}

export interface StatLine {
  label: string;
  value: number;
  tone: Tone;
}

/** The small stats strip: Jiras, PRs, review comments, needs attention, unknowns, not done. */
export function statsStrip(h: Rollup["headline"]): StatLine[] {
  return [
    { label: "Jiras", value: h.jiras, tone: "neutral" },
    { label: "PRs", value: h.prs, tone: "neutral" },
    { label: "Review comments", value: h.reviewComments, tone: "neutral" },
    { label: "Need attention", value: h.needAttention, tone: h.needAttention ? "danger" : "muted" },
    { label: "Unknowns", value: h.unknowns, tone: h.unknowns ? "warn" : "muted" },
    { label: "Not done", value: h.notDone, tone: h.notDone ? "danger" : "muted" },
  ];
}

export interface SummaryStatusLine {
  text: string;
  tone: Tone;
  /** The button: Generate with AI / Regenerate, or off with the reason. */
  button: { label: string; disabledReason: string | null };
}

type StatusIn = Pick<SummaryView, "status" | "source" | "generatedAt" | "model" | "note" | "ai">;

/**
 * The line under the headline and what the button says:
 *   fresh AI        "Summary: AI-written 20 Nov, 11:30 am IST (MiniMax-M2)"        [Regenerate]
 *   stale           "Summary: stale: the checklist changed since it was written"   [Regenerate]
 *   none / rules    "Summary: rules only (AI not available: <reason>)" or "(not generated yet)"   [Generate with AI]
 */
export function summaryStatusLine(v: StatusIn, canGenerate: boolean, needsRefresh = false): SummaryStatusLine {
  const offReason = !v.ai.available ? `AI is not available${v.ai.reason ? `: ${v.ai.reason}` : ""}` : !canGenerate ? "Only delivery managers can generate the summary" : needsRefresh ? "The stored data must be re-read first" : null;
  if (v.status === "fresh" && v.source === "ai") {
    return { text: `Summary: AI-written ${formatIst(v.generatedAt)} IST${v.model ? ` (${v.model})` : ""}`, tone: "ok", button: { label: "Regenerate", disabledReason: offReason } };
  }
  if (v.status === "stale") {
    return { text: "Summary: stale: the checklist changed since the AI summary was written; the rules summary is shown", tone: "warn", button: { label: "Regenerate", disabledReason: offReason } };
  }
  const why = !v.ai.available ? `AI not available${v.ai.reason ? `: ${v.ai.reason}` : ""}` : v.note ? v.note : "not generated yet";
  return { text: `Summary: rules only (${why})`, tone: "muted", button: { label: "Generate with AI", disabledReason: offReason } };
}

/** What the page shows when a generation is refused for rate: the server's own sentence, else a plain one. */
export function generateErrorText(status: number, message: string | null): string {
  if (status === 429) return message ?? "The summary was generated a moment ago; try again in a few seconds.";
  return message ?? "Could not generate the summary";
}

const jirasText = (e: { jiras: string[]; moreJiras?: number }) => (e.jiras.length ? ` (${e.jiras.join(", ")}${e.moreJiras ? `, +${e.moreJiras}` : ""})` : "");

/** The summary as plain text for the clipboard: the headline, the at-a-glance bullets, then each section's entries. */
export function summaryCopyText(opts: { environment: string; deliveryName: string; summary: Pick<MergedSummary, "headline" | "glance" | "sections">; source?: "ai" | "rules" }): string {
  const L: string[] = [`Summary for ${opts.environment.toUpperCase()} movement: ${opts.deliveryName}${opts.source ? ` (${opts.source === "ai" ? "AI-written" : "rules only"})` : ""}`, opts.summary.headline];
  const glance = orderGlance(opts.summary.glance);
  if (glance.length) {
    L.push("", "At a glance");
    for (const g of glance) L.push(`- [${g.badge}] ${plainLine(g.title)}${g.detail ? `: ${plainLine(g.detail)}` : ""}${jirasText(g)}`);
  }
  for (const s of opts.summary.sections) {
    if (!s.entries.length) continue;
    L.push("", s.title);
    for (const e of s.entries) L.push(`- ${e.title} [${e.badge}]${e.line ? `: ${plainLine(e.line)}` : ""}${jirasText(e)}`);
    if (s.more) L.push(`- ... ${s.more} more`);
  }
  return L.join("\n");
}

/** Does an entry carry something to expand (details, or the per-environment cells of a config)? */
export function entryExpandable(e: Pick<RollupEntry, "details" | "env">): boolean {
  return (e.details?.length ?? 0) > 0 || !!e.env;
}

// ---------------------------------------------------------------------------------------------
// plain language for the board and the tables
// ---------------------------------------------------------------------------------------------

export interface PlainDetail {
  plain: Plain;
  jiras: string[];
}
export interface PlainEntry {
  /** The one-line summary with tags, pointers and "unknown (x)" worded; never dropped (it is the table's main cell). */
  line: string;
  /** The secondary lines: each a lead and up to four points, with every sentence already shown elsewhere in the board left out. */
  details: PlainDetail[];
}
export interface PlainGlance {
  title: string;
  detail: Plain | null;
}
export interface PlainSummary {
  glance: Map<string, PlainGlance>;
  sections: Map<string, Map<string, PlainEntry>>;
}

/** An entry's one-liner in plain words (a pointer-only line stays as written so the row never goes blank). */
export function plainLine(raw: string): string {
  const c = cleanNoise(raw);
  return c.text || raw.trim();
}

/**
 * Plain wording for the whole board in one pass: every table line is registered first, then the glance details and the entry details are written
 * with a deduper, so a detail that repeats a line (or another detail) of the board is left out and each fact reads once.
 */
export function plainSummary(summary: Pick<MergedSummary, "glance" | "sections">): PlainSummary {
  const dedupe: Deduper = makeDeduper();
  const sections = new Map<string, Map<string, PlainEntry>>();
  const lines = new Map<string, string>();
  for (const s of summary.sections)
    for (const e of s.entries) {
      const line = plainLine(e.line);
      lines.set(`${s.id}|${e.key}`, line);
      dedupe.add(line);
    }
  for (const s of summary.sections) {
    const m = new Map<string, PlainEntry>();
    for (const e of s.entries) {
      const details: PlainDetail[] = [];
      for (const d of e.details ?? []) {
        const plain = plainify(d.text, { dedupe });
        if (!isEmptyPlain(plain)) details.push({ plain, jiras: d.jiras });
      }
      m.set(e.key, { line: lines.get(`${s.id}|${e.key}`) ?? plainLine(e.line), details });
    }
    sections.set(s.id, m);
  }
  const glance = new Map<string, PlainGlance>();
  const gd = makeDeduper();
  /** A glance bullet whose title is a long list cut with "…" and whose detail is the short sentence ("16 services to restart") is named by that sentence. */
  const swapped = new Set<string>();
  for (const g of summary.glance) {
    let title = plainLine(g.title);
    if (title.endsWith("…") && g.detail && g.detail.length <= 80) {
      title = plainLine(g.detail);
      swapped.add(g.id);
    }
    gd.add(title);
    glance.set(g.id, { title, detail: null });
  }
  for (const g of summary.glance) {
    // the card shows the Jiras as chips: a detail that only lists them again ("13 Jiras HELD: CAV-7280, CAV-7293, +5") says nothing more
    const detail = g.detail && g.jiras.length ? g.detail.replace(/\s*[—:-]\s*[A-Z][A-Z0-9]{1,9}-\d+(?:,\s*(?:[A-Z][A-Z0-9]{1,9}-\d+|\+\d+))*.*$/, "") : g.detail;
    const tk = plainLine(g.title).toLowerCase().replace(/[^a-z0-9]+/g, "");
    const dk = (detail ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const p = detail && !swapped.has(g.id) && !(dk.length >= 6 && (tk.includes(dk) || dk.includes(tk))) ? plainify(detail, { dedupe: gd, maxLead: 160 }) : null;
    const cur = glance.get(g.id) as PlainGlance;
    glance.set(g.id, { title: cur.title, detail: p && !isEmptyPlain(p) ? p : null });
  }
  return { glance, sections };
}

/** `(CAV-1, CAV-2, +3)` after a line. */
const jirasOf = (e: { jiras: string[]; moreJiras?: number }): string => (e.jiras.length ? ` (${e.jiras.join(", ")}${e.moreJiras ? `, +${e.moreJiras}` : ""})` : "");

/** One section of the summary tables as text for the clipboard: the title, then each entry with its badge, its line, its Jiras and its points. */
export function summarySectionText(section: RollupSection, plain: PlainSummary, env?: { environment: string; deliveryName: string }): string {
  const L: string[] = [env ? `${section.title} (${env.environment.toUpperCase()} movement: ${env.deliveryName})` : section.title];
  const entries = plain.sections.get(section.id);
  for (const e of section.entries) {
    const pe = entries?.get(e.key);
    {
      const ln = pe?.line ?? plainLine(e.line);
      L.push(`- ${e.title} [${e.badge}]${ln ? `: ${ln}` : ""}${jirasOf(e)}`);
    }
    for (const d of pe?.details ?? []) {
      const ls = plainLines(d.plain);
      ls.forEach((l, i) => L.push(`    ${i === 0 ? "-" : "  -"} ${l}${i === 0 && d.jiras.length ? ` (${d.jiras.join(", ")})` : ""}`));
    }
    const cells = e.env;
    if (cells) L.push(`    - Demo: ${cells.values.demo ?? "not set"}; UAT: ${cells.values.uat ?? "not set"}; Prod: ${cells.values.prod ?? "not set"}`);
  }
  if (section.more) L.push(`- ... ${section.more} more not listed`);
  return L.join("\n");
}

/** The "At a glance" board as text for the clipboard: severity order, badge, title, the plain detail and the Jiras. */
export function glanceText(glance: readonly Glance[], plain: PlainSummary, env?: { environment: string; deliveryName: string }): string {
  const L: string[] = [env ? `At a glance (${env.environment.toUpperCase()} movement: ${env.deliveryName})` : "At a glance"];
  for (const g of orderGlance(glance)) {
    const p = plain.glance.get(g.id);
    L.push(`- [${g.badge}] ${p?.title ?? plainLine(g.title)}${jirasOf(g)}`);
    if (p?.detail) for (const l of plainLines(p.detail)) L.push(`    - ${l}`);
  }
  if (glance.length === 0) L.push("Nothing stands out.");
  return L.join("\n");
}
