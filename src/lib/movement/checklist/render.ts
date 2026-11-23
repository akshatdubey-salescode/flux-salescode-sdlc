/**
 * Text (Copy button) and flat rows (Excel writer) of a checklist. Both read the same section
 * model, so what is copied and what is exported cannot drift apart. Pure; no I/O.
 */
import type { Checklist, ChecklistItem, ItemSource } from "./types";

/** `CAV-7346: channelkart#1184, kpi-dashboard#267; CAV-7304: ...` */
export function formatSources(sources: ItemSource[], more?: number): string {
  const byJira = new Map<string, string[]>();
  for (const s of sources) {
    // The Jira's one review comment covers several PRs: "review comment (2 PRs)".
    const pr = s.pr === "union" ? (s.n ? `review comment (${s.n} PR${s.n === 1 ? "" : "s"})` : "review comment") : s.pr;
    const l = byJira.get(s.jira);
    if (!l) byJira.set(s.jira, [pr]);
    else if (!l.includes(pr)) l.push(pr);
  }
  const parts = [...byJira.entries()].map(([j, prs]) => `${j}: ${prs.join(", ")}`);
  if (more) parts.push(`+${more} more`);
  return parts.join("; ");
}

/**
 * Neutralise spreadsheet formula injection: a cell that starts with = + - @ (or a tab / CR, which
 * Excel skips before it reads the formula) gets a leading single quote, so it is shown as text.
 * Every string cell of every row goes through this.
 */
export function excelSafe(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

const SEV_TAG = { blocker: "BLOCKER", warn: "WARN", info: "" } as const;

function envNote(it: ChecklistItem): string {
  if (!it.env) return "";
  const t = it.env.target;
  const v = it.env.values;
  const fmt = (e: "demo" | "uat" | "prod") => (e === t ? `${e.toUpperCase()} (target): ${v[e] ?? "UNKNOWN"}` : `${e}: ${v[e] ?? "unknown"}`);
  return ` -- ${fmt("demo")}; ${fmt("uat")}; ${fmt("prod")}`;
}

function flags(it: ChecklistItem): string[] {
  const out: string[] = [];
  if (it.severity && it.severity !== "info") out.push(it.label ?? SEV_TAG[it.severity]);
  else if (it.label) out.push(it.label);
  if (it.conflict) out.push(`CONFLICT ${it.conflict.kind}`);
  if (it.needsAttention) out.push("NEEDS ATTENTION");
  if (it.raw) out.push("raw text");
  return out;
}

function itemLine(cl: Checklist, it: ChecklistItem): string {
  const f = flags(it);
  const text = it.config ? `${it.config.key}${it.config.aliases?.length ? ` (also: ${it.config.aliases.join(", ")})` : ""}${it.config.store ? ` (${it.config.store})` : ""}${it.config.default !== undefined ? `, default ${it.config.default}` : ""}${envNote(it)}` : it.text;
  const indented = text.replace(/\n/g, "\n    ");
  const src = formatSources(it.sources, it.moreSources);
  const lead = it.seq !== undefined ? `${it.seq}. ` : "- ";
  return `${lead}${f.length ? `[${f.join("; ")}] ` : ""}${indented}${src ? ` [${src}]` : ""}`;
}

export function renderText(cl: Checklist): string {
  const L: string[] = [];
  L.push(`# Environment movement checklist: ${cl.environment.toUpperCase()}`);
  L.push("");
  L.push(
    `Jiras in this movement (${cl.scope.jiras.length}): ${cl.scope.jiras.map((j) => `${j.jira} (${j.readiness}, ${j.prs.length} PR${j.prs.length === 1 ? "" : "s"})`).join(", ") || "none"}`,
  );
  if (cl.held.length) L.push(`Held back (not in this checklist): ${cl.held.map((h) => `${h.jira} (${h.readiness})`).join(", ")}`);
  const missing = cl.signoffs.filter((s) => s.anyMissing);
  if (missing.length) {
    L.push(`Sign-off missing: ${missing.map((s) => `${s.jira} (${[s.dev === "missing" ? "dev" : "", s.tester === "missing" ? "tester" : ""].filter(Boolean).join(" + ")})`).join(", ")}`);
  }
  L.push("");

  if (cl.conflicts.length) {
    L.push(`## CONFLICTS (${cl.conflicts.length}): records disagree, decide before moving`);
    for (const c of cl.conflicts) {
      L.push(`- [${c.kind}] ${c.title}`);
      for (const v of c.variants) L.push(`    * ${v.text}${v.sources.length ? ` [${formatSources(v.sources)}]` : ""}`);
    }
    L.push("");
  }
  if (cl.unknownsByOwner.length) {
    L.push("## UNKNOWNS TO RESOLVE (by owner)");
    for (const g of cl.unknownsByOwner) {
      L.push(`### ${g.owner || "owner not named"} (${g.items.length + (g.more ?? 0)})`);
      for (const u of g.items) L.push(`- ${u.text}${u.sources.length ? ` [${formatSources(u.sources, u.moreSources)}]` : ""}`);
      if (g.more) L.push(`- ... ${g.more} more`);
    }
    L.push("");
  }
  if (cl.warnings.length) {
    L.push("## WARNINGS");
    for (const w of cl.warnings) L.push(`- ${w.message}${w.sources.length ? ` [${formatSources(w.sources)}]` : ""}`);
    L.push("");
  }
  for (const s of cl.sections) {
    L.push(`## ${s.number}. ${s.title}`);
    if (!s.items.length) L.push("- (nothing recorded)");
    for (const it of s.items) L.push(itemLine(cl, it));
    L.push("");
  }
  return L.join("\n").trimEnd() + "\n";
}

export interface ChecklistRow {
  kind: "item" | "conflict" | "unknown";
  section: string;
  item: string;
  text: string;
  sources: string;
  /** Target-environment value for config rows ("UNKNOWN" when none is known); "" otherwise. */
  envValue: string;
  flags: string;
}

/** Flat rows for the Excel writer (P7): conflicts, unknowns, then every section item. Every string cell is `excelSafe`. */
export function toRows(cl: Checklist): ChecklistRow[] {
  const rows: ChecklistRow[] = [];
  const push = (r: ChecklistRow) =>
    rows.push({ kind: r.kind, section: excelSafe(r.section), item: excelSafe(r.item), text: excelSafe(r.text), sources: excelSafe(r.sources), envValue: excelSafe(r.envValue), flags: excelSafe(r.flags) });
  const title = (id: string) => {
    const s = cl.sections.find((x) => x.id === id);
    return s ? `${s.number}. ${s.title}` : id;
  };
  for (const c of cl.conflicts) {
    push({
      kind: "conflict",
      section: title(c.section),
      item: c.itemKey,
      text: `${c.title}: ${c.variants.map((v) => v.text).join("  VS  ")}`,
      sources: formatSources(c.variants.flatMap((v) => v.sources)),
      envValue: "",
      flags: `CONFLICT ${c.kind}`,
    });
  }
  for (const g of cl.unknownsByOwner) {
    for (const u of g.items) push({ kind: "unknown", section: "Unknowns to resolve", item: g.owner || "owner not named", text: u.text, sources: formatSources(u.sources, u.moreSources), envValue: "", flags: "UNKNOWN" });
  }
  for (const s of cl.sections) {
    for (const it of s.items) {
      push({
        kind: "item",
        section: `${s.number}. ${s.title}`,
        item: it.key,
        text: it.seq !== undefined ? `${it.seq}. ${it.text}` : it.text,
        sources: formatSources(it.sources, it.moreSources),
        envValue: it.env ? (it.env.targetValue ?? "UNKNOWN") : "",
        flags: flags(it).join("; "),
      });
    }
  }
  return rows;
}
