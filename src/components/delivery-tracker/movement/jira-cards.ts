/**
 * The checklist of ONE Jira as plain-language CARDS (pure data, no React): "At a glance", "What to deploy", "Configuration", "Database and data",
 * "App and compatibility", "Testing", "Order of steps", "Rollback and undo", "Verify after deploy", "Open questions", "Pull requests" and the
 * "Release checklist" table. The panel renders the cards; every card also knows how to write itself as text for the clipboard, so what is on the
 * screen and what is copied come from the same blocks.
 *
 * Every fact is shown ONCE: the release-page rows that a card already shows in full appear in the release table only as "Shown under <card>".
 * All text goes through `plainify` (tags, pointers and "unknown (x)" rewritten, lists split) and through one deduper shared by the whole Jira.
 */
import type { ItemSeverity } from "@/lib/movement/checklist/types";
import { NOT_REPO } from "@/lib/movement/record/util";
import type { JiraChecklistView, PrRow, RowEntry, RowStateKind } from "./jira-checklist";
import { isEmptyPlain, makeDeduper, plainCopy, plainify, plainLines, plainOneLine, plainStatus, pointerRows, sentenceCase, sentencesOf, type Deduper, type Plain } from "./plain-text";

export type CardTone = "ok" | "warn" | "danger" | "info" | "muted" | "neutral";

export type Cell =
  | { kind: "text"; text: string; muted?: boolean; strong?: boolean }
  | { kind: "plain"; plain: Plain; muted?: boolean }
  | { kind: "answer"; state: RowStateKind; label: string }
  | { kind: "chips"; chips: Array<{ text: string; tone: CardTone }> }
  | { kind: "env"; values: Array<{ env: string; value: string | null; target: boolean }> }
  | { kind: "stack"; cells: Cell[] };

export interface TableRow {
  id: string;
  cells: Cell[];
  attention?: boolean;
}

export type Block =
  | { kind: "verdict"; verdict: string; tone: CardTone; reason: Plain; what: Plain | null }
  | { kind: "facts"; chips: Array<{ label: string; value: string; tone: CardTone }> }
  | { kind: "table"; label: string; columns: string[]; widths?: string[]; rows: TableRow[]; testId?: string }
  | { kind: "list"; title?: string; ordered?: boolean; items: Plain[]; tone?: CardTone }
  | { kind: "note"; text: string; muted?: boolean };

export interface Card {
  id: string;
  title: string;
  /** One plain sentence under the title: what the card is for. */
  about: string;
  /** Short count line next to the title ("3 services"). */
  hint: string;
  blocks: Block[];
}

export const CARD_TITLES = {
  glance: "At a glance",
  deploy: "What to deploy",
  config: "Configuration",
  data: "Database and data",
  app: "App and compatibility",
  testing: "Testing",
  order: "Order of steps",
  rollback: "Rollback and undo",
  verify: "Verify after deploy",
  open: "Open questions and risks",
  prs: "Pull requests",
  release: "Release checklist",
} as const;

/** Which card shows the full answer of a release-page row (the table then says "Shown under ..."). */
export const ROW_CARD: Record<string, keyof typeof CARD_TITLES> = {
  services_deploy: "deploy",
  services_restart: "deploy",
  bundle_sdk: "glance",
  configs_prod: "config",
  previous_data: "data",
  db_queries: "data",
  db_index: "data",
  ui_indexdb: "data",
  app_release: "app",
  old_app_version: "app",
  new_app_old_data: "app",
  features_old_data: "app",
  beta_compat: "app",
  designations: "app",
  scenarios: "testing",
  performance: "testing",
  automation_run: "testing",
  automation_updated: "testing",
};

// ---------------------------------------------------------------------------------------------
// small pieces
// ---------------------------------------------------------------------------------------------

const ANSWER_LABEL: Record<RowStateKind, string> = { done: "Done", notdone: "Not done", yes: "Yes", no: "No", na: "Not required", unknown: "Not known yet", other: "" };
const ANSWER_TONE: Record<RowStateKind, CardTone> = { done: "ok", notdone: "danger", yes: "info", no: "muted", na: "muted", unknown: "warn", other: "muted" };

const text = (t: string, o: { muted?: boolean; strong?: boolean } = {}): Cell => ({ kind: "text", text: t, ...o });
const plainCell = (p: Plain, muted?: boolean): Cell => ({ kind: "plain", plain: p, ...(muted ? { muted } : {}) });
const answerCell = (state: RowStateKind, label?: string): Cell => ({ kind: "answer", state, label: label ?? ANSWER_LABEL[state] });

/** "Yes / NOT DONE kpi#246 ..." (two answers in one row): the answer reads "Yes / Not done", the rest is the detail. */
function rowAnswer(r: RowEntry): { cell: Cell; details: string } {
  const m = /^\/\s*(not done|done)\b\s*([\s\S]*)$/i.exec(r.details);
  if (m && (r.state === "yes" || r.state === "no")) {
    const second = m[1].toLowerCase() === "done" ? "Done" : "Not done";
    return { cell: answerCell(second === "Done" ? "yes" : "notdone", `${ANSWER_LABEL[r.state]} / ${second}`), details: m[2] };
  }
  return { cell: answerCell(r.state), details: rowDetailsText(r) };
}

/** `(release manager) rest` of an "Unknown" row -> the owner and the rest. */
function unknownOwner(details: string): { owner: string | null; rest: string } {
  const m = /^\(([^)]{1,40})\)\.?\s*([\s\S]*)$/.exec(details);
  return m ? { owner: m[1].trim(), rest: m[2].trim() } : { owner: null, rest: details.trim() };
}

/** The text of a row's details with its unknown owner worded ("Release manager to confirm"). */
function rowDetailsText(r: RowEntry): string {
  if (r.state !== "unknown") return r.details;
  const { owner, rest } = unknownOwner(r.details);
  const who = owner ? `${sentenceCase(owner)} to confirm` : "";
  return [rest, who].filter(Boolean).join(rest && who ? ". " : "");
}

const tryRow = (v: JiraChecklistView, id: string): RowEntry | undefined => v.rows.find((r) => r.id === id);

function answerOf(r: RowEntry | undefined): { label: string; tone: CardTone } {
  if (!r) return { label: "not stated", tone: "muted" };
  if (r.state === "other") return { label: "see below", tone: "info" };
  return { label: ANSWER_LABEL[r.state], tone: ANSWER_TONE[r.state] };
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Split a text at "; " or " · " outside parentheses, so "A (x; y); B" gives two pieces. */
function splitTop(s: string, sep: RegExp): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  const re = new RegExp(`^(?:${sep.source})`);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")" && depth > 0) depth--;
    if (depth === 0) {
      const m = re.exec(s.slice(i));
      if (m && m[0].length > 0) {
        out.push(cur.trim());
        cur = "";
        i += m[0].length - 1;
        continue;
      }
    }
    cur += c;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

// ---------------------------------------------------------------------------------------------
// what to deploy: each service once, with its action(s)
// ---------------------------------------------------------------------------------------------

interface ServiceEntry {
  name: string;
  deploy: boolean;
  restart: boolean;
  notes: string[];
}

/** "Channel Kart (from master)" -> name + note; "Channel Kart - code change; x" -> name + note; "Slake Reporting: executor jar" -> name + note. */
function nameAndNote(raw: string): { name: string; note: string } {
  const t = raw.trim().replace(/[.;]+$/, "");
  const paren = /^([^():]{2,60}?)\s+\(([^()]*)\)\s*([\s\S]*)$/.exec(t);
  const dash = /^(.{2,60}?)(?:\s+[-–—]\s+|:\s+)([\s\S]*)$/.exec(t);
  // "Channel Kart (code); properties need cache clear only": the bracket opens the note, what follows it continues the note
  if (paren && (!dash || paren[1].length <= dash[1].length)) {
    const rest = paren[3].replace(/^[;,.\s]+/, "");
    return { name: paren[1].trim(), note: [paren[2].trim(), rest].filter(Boolean).join("; ") };
  }
  if (dash) return { name: dash[1].trim(), note: dash[2].trim() };
  return { name: t, note: "" };
}

/** A service name looks like a name: short, starts with a capital letter or digit, no sentence verbs of a free note. */
const looksLikeName = (n: string): boolean => n.length >= 2 && n.length <= 48 && /^[A-Z0-9]/.test(n) && n.split(/\s+/).length <= 6;

export function buildServices(v: JiraChecklistView): { entries: ServiceEntry[]; leftovers: string[]; notDeployed: string | null } {
  // the server's own list (one entry per canonical service from the Jira's records): the card never re-reads item texts
  if (v.serviceList) {
    const sl = v.serviceList;
    return {
      entries: sl.services.map((x) => ({
        name: x.name,
        deploy: x.deploy,
        restart: x.restart,
        notes: x.deployNote && x.restartNote ? [`Deploy: ${x.deployNote}`, `Restart: ${x.restartNote}`] : [x.deployNote ?? x.restartNote ?? ""].filter(Boolean),
      })),
      leftovers: sl.also,
      notDeployed: sl.notNeeded.length ? sl.notNeeded.join(", ") : null,
    };
  }
  const entries = new Map<string, ServiceEntry>();
  const leftovers: string[] = [];
  let notDeployed: string | null = null;
  const find = (name: string): ServiceEntry | undefined => {
    const k = norm(name);
    if (!k) return undefined;
    for (const [ek, e] of entries) if (ek === k || (k.length >= 5 && (ek.startsWith(k) || k.startsWith(ek)) && Math.min(ek.length, k.length) >= 5)) return e;
    return undefined;
  };
  const add = (name: string, action: "deploy" | "restart", note: string) => {
    const nm = name.trim();
    let e = find(nm);
    if (!e) {
      e = { name: nm, deploy: false, restart: false, notes: [] };
      entries.set(norm(nm), e);
    }
    e[action] = true;
    const n = note.trim();
    if (n && !e.notes.some((x) => norm(x) === norm(n))) e.notes.push(n);
  };

  // 1. structured items (svc: / restart:)
  for (const s of v.services.deploy) {
    const { name, note } = nameAndNote(s);
    add(name, "deploy", note);
  }
  for (const s of v.services.restart) {
    const { name, note } = nameAndNote(s);
    add(name, "restart", note);
  }
  // 2. the release-page rows (the only source of many comments): "A · B · C (no bundle, no app)" and "A (code); x. B: y. C: z"
  const deployRow = tryRow(v, "services_deploy");
  if (deployRow && deployRow.state !== "no" && deployRow.state !== "na") {
    let d = rowDetailsText(deployRow);
    const trailing = /\s*\(((?:no|not)\b[^()]*)\)\s*$/i.exec(d);
    if (trailing) {
      notDeployed = trailing[1].trim();
      d = d.slice(0, trailing.index).trim();
    }
    const parts = d.includes(" · ") ? splitTop(d, / · /) : [];
    if (parts.length >= 2 || (parts.length === 1 && looksLikeName(parts[0]))) for (const p of parts) add(p.replace(/[.;]+$/, ""), "deploy", "");
    else if (d) {
      // "Slake Reporting only (executor + configs)": one service
      const one = nameAndNote(d);
      const only = /\s+only$/i.test(one.name);
      const name = only ? one.name.replace(/\s+only$/i, "") : one.name;
      if ((only || one.note) && looksLikeName(name) && name.split(/\s+/).length <= 4 && d.length <= 90) add(name, "deploy", only ? `only: ${one.note}`.replace(/:\s*$/, "") : one.note);
      else leftovers.push(d);
    }
  }
  const restartRow = tryRow(v, "services_restart");
  if (restartRow && restartRow.state !== "no" && restartRow.state !== "na") {
    const cleaned = plainify(rowDetailsText(restartRow), { maxLead: 10_000, maxBullets: 50 });
    for (const sentence of plainLines(cleaned)) {
      const { name, note } = nameAndNote(sentence);
      if (name && (find(name) || (note && looksLikeName(name)))) add(name, "restart", note);
      else leftovers.push(sentence);
    }
  }
  // 3. free notes (deploynote:/restartnote:) that say something the entries do not
  for (const n of v.services.notes) {
    const key = norm(n);
    const covered = [...entries.values()].some((e) => norm(e.name).length >= 5 && key.includes(norm(e.name)) && e.notes.some((x) => key.includes(norm(x).slice(0, 24)))) || [...entries.keys()].every((k) => key.includes(k) || k.length < 5);
    if (!covered && !leftovers.some((l) => norm(l).includes(key) || key.includes(norm(l)))) leftovers.push(n);
  }
  return { entries: [...entries.values()], leftovers, notDeployed };
}

// ---------------------------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------------------------

/** "channelkart client property collections.invoice.order.source.enabled = true (PUT /v1/properties?...). On for ckcoeuat only" -> where / value / notes. */
function configFromItem(item: string, keys: string[]): { key: string; where: string; value: string | null; notes: string } | null {
  let best: { key: string; at: number } | null = null;
  for (const k of keys) {
    const at = item.indexOf(k);
    if (at < 0) continue;
    // a key that is only the tail of a longer key in the same item ("order.source.enabled" inside "collections.invoice.order.source.enabled") is not a key of its own
    const before = item[at - 1];
    if (before && /[\w.-]/.test(before)) continue;
    if (!best || k.length > best.key.length) best = { key: k, at };
  }
  if (!best) {
    // a key the row did not list: "kpi-dashboard clientconfig showCollectionOrderSource = true"
    const m = /\b([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+|[a-z]+(?:[A-Z][a-z0-9]+)+)\s*=\s*/.exec(item);
    if (!m) return null;
    best = { key: m[1], at: m.index };
  }
  const where = item.slice(0, best.at).trim().replace(/[:\-–—]+$/, "").trim();
  const after = item.slice(best.at + best.key.length).trim();
  const vm = /^=\s*("[^"]*"|\S+?)(?=[\s.,;)]|$)/.exec(after) ?? /^("[^"]*")(?=[\s.,;)]|$)/.exec(after);
  const value = vm ? vm[1] : null;
  const notes = (vm ? after.slice(vm[0].length) : after).trim().replace(/^[.,;\s]+/, "");
  return { key: best.key, where, value, notes };
}

// ---------------------------------------------------------------------------------------------
// the cards
// ---------------------------------------------------------------------------------------------

const SEV_TONE: Record<string, CardTone> = { blocker: "danger", warn: "warn", info: "info" };

function riskLabel(label: string | undefined, sev: ItemSeverity | undefined): { text: string; tone: CardTone } {
  const l = (label ?? "").toLowerCase();
  if (l.startsWith("block") || sev === "blocker") return { text: "Must fix", tone: "danger" };
  if (l.startsWith("should")) return { text: "Should fix", tone: "warn" };
  if (l.startsWith("nit")) return { text: "Minor", tone: "muted" };
  return { text: label && label !== "Note" ? label : "Note", tone: sev ? (SEV_TONE[sev] ?? "muted") : "muted" };
}

/** "5 merged" etc. */
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The numbered "1 A 2 B 3 C" run of a deploy-order step text (the first item has no number) -> its items. */
export function splitNumberedRun(t: string): string[] | null {
  const marks: Array<{ at: number; end: number }> = [];
  let want = 2;
  const re = /\s(\d{1,2})\s(?=\S)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    if (Number(m[1]) === want) {
      marks.push({ at: m.index, end: m.index + m[0].length });
      want++;
    }
  }
  if (marks.length < 2) return null;
  // "net: 1 channelkart #1146 ... 2 index script ...": the label stays, the "1" goes
  const first = t.slice(0, marks[0].at).replace(/^((?:[A-Za-z ]{1,12}:\s*)?)1\s+/, "$1");
  const items = [first, ...marks.map((mk, i) => t.slice(mk.end, i + 1 < marks.length ? marks[i + 1].at : t.length))].map((s) => s.trim().replace(/[.;]+$/, "")).filter(Boolean);
  return items.length >= 3 ? items : null;
}

const ACRONYMS: Record<string, string> = { qa: "QA", ba: "BA", dba: "DBA", dev: "Dev", sfa: "SFA", dms: "DMS", ui: "UI" };
/** "qa" -> "QA", "release manager" -> "Release manager" (the owner as a person would write it). */
export function ownerLabel(owner: string): string {
  const o = owner.trim();
  if (!o) return "Owner not named";
  return o
    .split(/\s+/)
    .map((w, i) => ACRONYMS[w.toLowerCase()] ?? (i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * What is not known, for one owner: the words in front of each "not known yet — <owner> to confirm" in the row the unknown came from
 * ("Oldest supported build", "What QA ran", "Slake Reporting: executor jar + config reload (how)"). A row that is only an unknown gives its label.
 */
function questionsOf(text: string, owner: string, v: JiraChecklistView): string[] {
  const row = v.rows.find((r) => r.label && norm(text).startsWith(norm(r.label)));
  const own = norm(owner);
  const out: string[] = [];
  if (row) {
    const body = row.state === "unknown" ? "" : plainify(row.details, { maxLead: 100_000, maxBullets: 100 });
    const flat = typeof body === "string" ? "" : plainLines(body).flatMap((l) => sentencesOf(l)).join(" \u0001 ");
    const re = /([^\u0001.;]*?)\s*\(?(?:how:\s*)?not known yet — ([^)\u0001]*?) to confirm\)?/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(flat)) !== null) {
      const who = norm(m[2]);
      if (own && who && !(own.includes(who) || who.includes(own))) continue;
      let q = m[1].replace(/[:=\s(]+$/, "").replace(/^[^:]*?\b(?:is|are)\b\s+/, "");
      const how = /\(how:\s*$/i.test(m[0].slice(0, m[0].indexOf("not known"))) || /how:\s*$/i.test(m[1]);
      q = q.replace(/\s*\(how$/i, "").replace(/how:\s*$/i, "").trim();
      if (q.length > 140) q = q.slice(q.lastIndexOf(" ", 140)).trim();
      if (q) out.push(sentenceCase(how ? `${q} — how it is done` : q));
    }
    if (out.length === 0) out.push(row.label.replace(/\s*\?$/, ""));
  } else {
    const cleaned = plainify(text, { maxLead: 100_000, maxBullets: 50 });
    out.push(plainLines(cleaned)[0] ?? text);
  }
  return [...new Set(out)];
}

export function buildJiraCards(v: JiraChecklistView): Card[] {
  const dedupe: Deduper = makeDeduper();
  const cards: Card[] = [];
  const shown = new Set<string>(); // row ids whose full content a card shows

  // ---- What to deploy ------------------------------------------------------------------------
  const svc = buildServices(v);
  for (const r of ["services_deploy", "services_restart"]) shown.add(r);
  const deployRows: TableRow[] = svc.entries.map((e) => {
    const notes = plainify(e.notes.join("; "), { dedupe, maxLead: 120 });
    const actions: Array<{ text: string; tone: CardTone }> = [];
    if (e.deploy) actions.push({ text: "Deploy", tone: "info" });
    if (e.restart) actions.push({ text: "Restart", tone: "warn" });
    return { id: `svc:${norm(e.name)}`, cells: [text(e.name, { strong: true }), { kind: "chips", chips: actions }, isEmptyPlain(notes) ? text("—", { muted: true }) : plainCell(notes)] };
  });
  const deployBlocks: Block[] = [];
  if (deployRows.length) deployBlocks.push({ kind: "table", label: "Services", columns: ["Service", "Deploy / Restart", "Notes"], widths: ["26%", "22%", "52%"], rows: deployRows, testId: "movement-jira-service-table" });
  const deployNotes: Plain[] = [];
  for (const l of svc.leftovers) {
    const p = plainify(l, { dedupe, maxLead: 200 });
    if (!isEmptyPlain(p)) deployNotes.push(p);
  }
  if (deployNotes.length) deployBlocks.push({ kind: "list", title: deployRows.length ? "Also" : undefined, items: deployNotes });
  if (svc.notDeployed) deployBlocks.push({ kind: "note", text: `Not needed: ${svc.notDeployed.replace(/^no\s+/i, "").replace(/,\s*no\s+/gi, ", ").replace(/^not\s+/i, "")}`, muted: true });
  for (const d of v.services.downtime) {
    const p = plainify(d, { dedupe });
    if (!isEmptyPlain(p)) deployBlocks.push({ kind: "list", title: "Downtime", items: [p], tone: "danger" });
  }
  if (deployBlocks.length === 0 && (v.services.none.deploy || v.services.none.restart)) deployBlocks.push({ kind: "note", text: "Nothing to deploy or restart for this Jira.", muted: true });
  if (deployBlocks.length === 0) deployBlocks.push({ kind: "note", text: "This review comment names no service.", muted: true });

  // ---- Configuration -------------------------------------------------------------------------
  const cfgRow = tryRow(v, "configs_prod");
  const cfgBlocks: Block[] = [];
  const cfgKeys = [...new Set([...v.configs.rows.map((c) => c.key), ...v.configs.chips])];
  let cfgCount = 0;
  if (v.configs.rows.length) {
    shown.add("configs_prod");
    cfgCount = v.configs.rows.length;
    const target = v.configs.rows.find((r) => r.env)?.env?.target ?? null;
    const rows: TableRow[] = v.configs.rows.map((c) => {
      const aliases = c.aliases.length ? `Also called ${c.aliases.join(", ")}` : "";
      return {
        id: `cfg:${c.key}`,
        attention: c.needsAttention,
        cells: [
          text(c.key, { strong: true }),
          c.store ? plainCell(plainify(c.store, { maxLead: 60 })) : text("—", { muted: true }),
          c.default ? plainCell(plainify(`Default ${c.default}`, { maxLead: 90 })) : text("—", { muted: true }),
          c.env ? { kind: "env", values: (["demo", "uat", "prod"] as const).map((e) => ({ env: e === "uat" ? "UAT" : e[0].toUpperCase() + e.slice(1), value: c.env?.values[e] ?? null, target: target === e })) } : text("—", { muted: true }),
          aliases ? text(aliases, { muted: true }) : text("—", { muted: true }),
        ],
      };
    });
    cfgBlocks.push({ kind: "table", label: "Configuration keys", columns: ["Key / file", "Where", "Value or default", "Environments", "Notes"], widths: ["24%", "14%", "20%", "26%", "16%"], rows, testId: "movement-jira-config-table" });
    if (cfgRow) {
      const left = plainify(cfgRow.details, { dedupe, maxLead: 200 });
      if (!isEmptyPlain(left) && cfgRow.state !== "no") cfgBlocks.push({ kind: "list", title: "What to change", items: [left] });
    }
  } else if (cfgRow && cfgRow.state !== "no" && cfgRow.state !== "na") {
    shown.add("configs_prod");
    // the keys are named by the row: one table row per "a) ... b) ..." item that holds a key
    const cleaned = plainify(rowDetailsText(cfgRow), { maxLead: 10_000, maxBullets: 100 });
    const lines = plainLines(cleaned);
    const rows: TableRow[] = [];
    const rest: string[] = [];
    let intro = "";
    const used = new Set<string>();
    lines.forEach((line, idx) => {
      const c = configFromItem(line, cfgRow.chips.length ? cfgRow.chips : cfgKeys);
      if (c && !used.has(c.key)) {
        used.add(c.key);
        const notes = plainify(c.notes, { dedupe, maxLead: 120 });
        rows.push({
          id: `cfg:${c.key}`,
          cells: [text(c.key, { strong: true }), c.where ? text(c.where) : text("—", { muted: true }), c.value ? text(c.value) : text("—", { muted: true }), text("—", { muted: true }), isEmptyPlain(notes) ? text("—", { muted: true }) : plainCell(notes)],
        });
      } else if (idx === 0 && lines.length > 1 && !/[=]/.test(line)) intro = line;
      else rest.push(line);
    });
    cfgCount = rows.length || cfgRow.chips.length;
    if (intro) cfgBlocks.push({ kind: "note", text: sentenceCase(intro) });
    if (rows.length) cfgBlocks.push({ kind: "table", label: "Configuration keys", columns: ["Key / file", "Where", "Value or default", "Environments", "Notes"], widths: ["24%", "14%", "20%", "26%", "16%"], rows, testId: "movement-jira-config-table" });
    const restPlain = rest.map((r) => plainify(r, { dedupe })).filter((p) => !isEmptyPlain(p));
    if (restPlain.length) cfgBlocks.push({ kind: "list", title: rows.length ? "Also" : "What to change", items: restPlain });
    if (!rows.length && cfgRow.chips.length) cfgBlocks.unshift({ kind: "table", label: "Configuration keys", columns: ["Key / file"], rows: cfgRow.chips.map((k) => ({ id: `cfg:${k}`, cells: [text(k, { strong: true })] })), testId: "movement-jira-config-table" });
  } else if (cfgRow) {
    shown.add("configs_prod");
    cfgBlocks.push({ kind: "note", text: v.configs.none ?? "No configuration change.", muted: true });
  } else cfgBlocks.push({ kind: "note", text: v.configs.none ?? "This review comment names no configuration change.", muted: true });

  // ---- Database and data ---------------------------------------------------------------------
  const dbItems = v.kv.filter((k) => k.group === "Database");
  const qaRow = (id: string, label: string): TableRow | null => {
    const r = tryRow(v, id);
    if (!r) return null;
    shown.add(id);
    // the release-page row is the ONE place of this answer (the checklist no longer also writes it as a "db:" item)
    const body = rowDetailsText(r);
    const p = plainify(body, { dedupe });
    return { id: `row:${id}`, attention: r.needsAttention, cells: [text(label, { strong: true }), answerCell(r.state), isEmptyPlain(p) ? text("—", { muted: true }) : plainCell(p)] };
  };
  const dataRows = [qaRow("previous_data", "Fix old data after deploy?"), qaRow("db_queries", "Database change queries?"), qaRow("db_index", "Database index?"), qaRow("ui_indexdb", "Browser database (IndexedDB) version?")].filter((x): x is TableRow => !!x);
  const dataBlocks: Block[] = [];
  if (dataRows.length) dataBlocks.push({ kind: "table", label: "Database and data", columns: ["Question", "Answer", "What to do"], widths: ["24%", "12%", "64%"], rows: dataRows, testId: "movement-jira-data-table" });
  const dataExtra: Plain[] = [];
  for (const k of dbItems) {
    const p = plainify(k.key?.startsWith("sql:") ? `SQL to run: ${k.value}` : k.value, { dedupe });
    if (!isEmptyPlain(p)) dataExtra.push(p);
  }
  if (dataExtra.length) dataBlocks.push({ kind: "list", title: dataRows.length ? "Also" : undefined, items: dataExtra });
  if (dataBlocks.length === 0) dataBlocks.push({ kind: "note", text: "This review comment says nothing about database or data changes.", muted: true });

  // ---- App and compatibility -----------------------------------------------------------------
  const appKv = v.kv.filter((k) => k.group !== "Database");
  const appRows = [
    qaRow2("app_release", "New app release?"),
    qaRow2("old_app_version", "Test on an old app version?"),
    qaRow2("new_app_old_data", "New code works with old data?"),
    qaRow2("features_old_data", "Features work with old data?"),
    qaRow2("beta_compat", "Old apps keep working?"),
    qaRow2("designations", "Test these roles"),
  ].filter((x): x is TableRow => !!x);
  function qaRow2(id: string, label: string): TableRow | null {
    const r = tryRow(v, id);
    if (!r) return null;
    shown.add(id);
    const p = plainify(rowDetailsText(r), { dedupe });
    const ptrs = pointerRows([...p.pointers]);
    const ptrNote = ptrs.length && isEmptyPlain(p) ? `Same as ${ptrs.map((n) => `row ${n}${rowLabelAt(v, n) ? ` (${rowLabelAt(v, n)})` : ""}`).join(" and ")}` : "";
    return { id: `row:${id}`, attention: r.needsAttention, cells: [text(label, { strong: true }), answerCell(r.state), isEmptyPlain(p) ? text(ptrNote || "—", { muted: true }) : plainCell(p)] };
  }
  const appBlocks: Block[] = [];
  if (appRows.length) appBlocks.push({ kind: "table", label: "App and compatibility", columns: ["Question", "Answer", "What to know"], widths: ["26%", "12%", "62%"], rows: appRows, testId: "movement-jira-app-table" });
  const appExtra: Plain[] = [];
  for (const k of appKv) {
    const p = plainify(k.value, { dedupe });
    if (!isEmptyPlain(p)) appExtra.push(p);
  }
  if (appExtra.length) appBlocks.push({ kind: "list", title: appRows.length ? "Also" : undefined, items: appExtra });
  if (appBlocks.length === 0) appBlocks.push({ kind: "note", text: "This review comment says nothing about the app.", muted: true });

  // ---- Testing -------------------------------------------------------------------------------
  const testRows: TableRow[] = [];
  for (const [id, label] of [["scenarios", "Scenarios to test"], ["performance", "Performance tests"], ["automation_run", "Automation tests to run"], ["automation_updated", "Automation tests to update"]] as const) {
    const r = tryRow(v, id);
    if (!r) continue;
    shown.add(id);
    const p = plainify(rowDetailsText(r), { dedupe });
    if (id === "scenarios" && isEmptyPlain(p) && r.state === "other") continue; // only "see LIKELY TO BE MISSED below": that list is right here
    testRows.push({ id: `row:${id}`, attention: r.needsAttention, cells: [text(label, { strong: true }), answerCell(r.state), isEmptyPlain(p) ? text("—", { muted: true }) : plainCell(p)] });
  }
  const testBlocks: Block[] = [];
  if (testRows.length) testBlocks.push({ kind: "table", label: "Testing", columns: ["Check", "Answer", "What to do"], widths: ["22%", "12%", "66%"], rows: testRows, testId: "movement-jira-testing-table" });
  const missed = v.testing.missed.map((m) => plainify(m, { dedupe })).filter((p) => !isEmptyPlain(p));
  if (missed.length) testBlocks.push({ kind: "list", title: "Likely to be missed", ordered: true, items: missed });
  const roles = v.testing.roles.map((m) => plainify(m.replace(/^Check:\s*/i, ""), { dedupe })).filter((p) => !isEmptyPlain(p));
  if (roles.length) testBlocks.push({ kind: "list", title: "Roles to test", items: roles });
  const owners = v.testing.owners.map((o) => plainify(o.text, { dedupe })).filter((p) => !isEmptyPlain(p));
  if (owners.length) testBlocks.push({ kind: "list", title: "Test owners", items: owners });
  const other = v.testing.other.map((m) => plainify(m, { dedupe })).filter((p) => !isEmptyPlain(p));
  if (other.length) testBlocks.push({ kind: "list", items: other });
  if (testBlocks.length === 0) testBlocks.push({ kind: "note", text: "No testing notes in this review comment.", muted: true });

  // ---- Order, rollback, verify ---------------------------------------------------------------
  const steps: Plain[] = [];
  for (const s of v.order.steps) {
    const parts = splitNumberedRun(s.label);
    if (parts) for (const x of parts) steps.push(plainify(x, { dedupe }));
    else steps.push(plainify(s.label, { dedupe }));
  }
  const stepsKept = steps.filter((p) => !isEmptyPlain(p));
  const orderBlocks: Block[] = [];
  if (stepsKept.length) orderBlocks.push({ kind: "list", ordered: true, items: stepsKept });
  const gates = v.order.gates.map((g) => plainify(g, { dedupe })).filter((p) => !isEmptyPlain(p));
  if (gates.length) orderBlocks.push({ kind: "list", title: "Before you start", items: gates, tone: "warn" });
  if (orderBlocks.length === 0) orderBlocks.push({ kind: "note", text: "No deploy order is stated.", muted: true });

  const rb = v.order.rollback.map((g) => plainify(g, { dedupe })).filter((p) => !isEmptyPlain(p));
  const undo = v.order.undo.map((g) => plainify(g, { dedupe })).filter((p) => !isEmptyPlain(p));
  const rollbackBlocks: Block[] = [];
  if (rb.length) rollbackBlocks.push({ kind: "list", title: "Rollback", items: rb });
  if (undo.length) rollbackBlocks.push({ kind: "list", title: "Undo", items: undo });
  if (rollbackBlocks.length === 0) rollbackBlocks.push({ kind: "note", text: "No rollback is described.", muted: true });

  const verify = v.order.verify.map((g) => plainify(g, { dedupe })).filter((p) => !isEmptyPlain(p));
  const verifyBlocks: Block[] = verify.length ? [{ kind: "list", ordered: true, items: verify }] : [{ kind: "note", text: "No check after deploy is described.", muted: true }];

  // ---- Open questions and risks --------------------------------------------------------------
  const qRows: TableRow[] = [];
  const seenQ = new Set<string>();
  for (const g of v.open.groups)
    for (const t of g.items)
      for (const q of questionsOf(t, g.owner, v)) {
        const k = `${norm(g.owner)}|${norm(q)}`;
        if (seenQ.has(k)) continue;
        seenQ.add(k);
        qRows.push({ id: `q:${qRows.length}`, cells: [text(ownerLabel(g.owner), { strong: true }), plainCell(plainify(q, { maxLead: 160 }))] });
      }
  const openBlocks: Block[] = [];
  if (qRows.length) openBlocks.push({ kind: "table", label: "Open questions", columns: ["Owner", "To confirm"], widths: ["24%", "76%"], rows: qRows, testId: "movement-jira-questions-table" });
  const rRows: TableRow[] = [];
  for (const r of v.open.risks) {
    const notRead = /^Other:\s*NOT READ:?\s*/i.exec(r.text);
    const lab = notRead ? { text: "Not reviewed", tone: "muted" as CardTone } : r.open ? { text: "Still open", tone: "info" as CardTone } : riskLabel(r.label, r.severity);
    const body = notRead ? r.text.slice(notRead[0].length) : r.text;
    const p = plainify(body, { dedupe, maxLead: 10_000, maxBullets: 20 });
    const lines = plainLines(p);
    // "A; B; C" clauses are separate rows
    const pieces = lines.length === 1 ? splitTop(lines[0], /;\s+/) : lines;
    for (const piece of pieces) {
      const one = plainify(piece, { maxLead: 160 });
      if (!isEmptyPlain(one)) rRows.push({ id: `risk:${rRows.length}`, cells: [{ kind: "chips", chips: [{ text: lab.text, tone: lab.tone }] }, plainCell(one)] });
    }
  }
  if (rRows.length) openBlocks.push({ kind: "table", label: "Risks and open items", columns: ["Kind", "Item"], widths: ["16%", "84%"], rows: rRows, testId: "movement-jira-risks-table" });
  if (openBlocks.length === 0) openBlocks.push({ kind: "note", text: "None.", muted: true });

  // ---- Pull requests -------------------------------------------------------------------------
  // "Merged PRs: approved and merged by X" names the approver of the PRs whose own line does not say it
  const generic = v.approvals.map((a) => /^(?:all )?approved and merged by ([\w.-]+)/i.exec(a.trim())).find((m) => m);
  const prRows: TableRow[] = v.prs.map((p) => prRow(p, generic?.[1] ?? null));
  const prBlocks: Block[] = [];
  if (prRows.length) prBlocks.push({ kind: "table", label: "Merged pull requests", columns: ["PR", "Base", "What it does", "Approval"], widths: ["26%", "14%", "40%", "20%"], rows: prRows, testId: "movement-jira-pr-table" });
  const prNotes: Plain[] = [];
  for (const a of v.approvals) {
    if (generic && /^(?:all )?approved and merged by [\w.-]+\s*$/i.test(a.trim())) continue;
    const p = plainify(a, { dedupe });
    if (!isEmptyPlain(p)) prNotes.push(p);
  }
  if (prNotes.length) prBlocks.push({ kind: "list", title: "Notes", items: prNotes });
  const titles: Record<string, string> = { open: "Still open, not released", reverted: "Reverted, do not deploy as features", stack: "Merged only into stack branches, nothing released" };
  for (const kind of ["open", "reverted", "stack"] as const) {
    // "of#1341" and "by#1370" (words before a bare number, read as PRs by an older reader) are not PRs
    const junk = (piece: string): boolean => {
      const m = /^([^\s#]+)#\d+/.exec(piece.trim());
      return !!m && NOT_REPO.has(m[1].toLowerCase());
    };
    const items = v.notReleased.filter((n) => n.kind === kind).flatMap((n) => splitTop(n.text.replace(/^[^:]*:\s*/, ""), /;\s+/)).filter((p) => !junk(p));
    const plains = items.map((i) => plainify(prLine(i), { dedupe, maxLead: 200 })).filter((p) => !isEmptyPlain(p));
    if (plains.length) prBlocks.push({ kind: "list", title: titles[kind], items: plains, tone: "warn" });
  }
  if (prBlocks.length === 0) prBlocks.push({ kind: "note", text: "No pull request is listed in this review comment.", muted: true });
  const notReleasedCount = v.notReleased.reduce((n, x) => n + Math.max(1, x.prs.length), 0);

  // ---- Release checklist table ---------------------------------------------------------------
  const folded: string[] = [];
  const relRows: TableRow[] = [];
  const asked = new Set(qRows.map((r) => norm(cellText(r.cells[1]))));
  const cardTitle = (id: string) => CARD_TITLES[ROW_CARD[id] ?? "release"];
  for (const r of v.rows) {
    const bare = !rowDetailsText(r).trim();
    const questionLike = /\b(?:required|req\.?|needed)\b/i.test(r.label);
    if (r.state === "na" || (r.state === "no" && bare && questionLike)) {
      folded.push(r.label.replace(/\s*(?:required|req\.)?\s*\/?\s*(?:done)?\s*\?\s*$/i, "").trim() || r.label);
      continue;
    }
    let details: Cell;
    const ans = rowAnswer(r);
    if (r.state === "unknown" && !unknownOwner(r.details).rest && asked.has(norm(r.label.replace(/\s*\?$/, "")))) {
      // an unknown that is only a question for an owner is listed under Open questions
      details = text(`Shown under ${CARD_TITLES.open}`, { muted: true });
    } else if (ROW_CARD[r.id] && shown.has(r.id)) {
      const where = cardTitle(r.id);
      details = text(`Shown under ${where}`, { muted: true });
    } else {
      const p = r.id === "cherry_pick" ? repoClauses(ans.details, dedupe) : plainify(ans.details, { dedupe });
      const ptrs = pointerRows([...p.pointers]);
      details = !isEmptyPlain(p) ? plainCell(p) : text(ptrs.length ? `Same as ${ptrs.map((n) => `row ${n}${rowLabelAt(v, n) ? ` (${rowLabelAt(v, n)})` : ""}`).join(" and ")}` : "—", { muted: true });
    }
    relRows.push({ id: `rel:${r.id}`, attention: r.needsAttention, cells: [text(String(r.n), { muted: true }), text(r.label.replace(/\s*\?$/, ""), { strong: true }), ans.cell, details] });
  }
  const releaseBlocks: Block[] = [];
  if (relRows.length) releaseBlocks.push({ kind: "table", label: "Release checklist", columns: ["#", "Item", "Answer", "Details"], widths: ["5%", "28%", "13%", "54%"], rows: relRows, testId: "movement-jira-release-table" });
  else releaseBlocks.push({ kind: "note", text: "No row of the release page is answered in this review comment.", muted: true });
  for (const n of v.notRequired) if (!folded.includes(n)) folded.push(n);
  if (folded.length) releaseBlocks.push({ kind: "note", text: `Not needed: ${[...new Set(folded)].join(", ")}`, muted: true });

  // ---- At a glance (built last: it counts what the other cards hold) ---------------------------
  const st = plainStatus(v.header.statusWord, v.header.statusText);
  const verdictTone: CardTone = st.verdict === "Ready" ? "ok" : st.verdict === "Blocked" ? "danger" : st.verdict === "Not stated" ? "muted" : "warn";
  const whatP = v.header.what ? plainify(v.header.what, { maxLead: 200 }) : null;
  const sdk = v.services.sdk[0];
  const chip = (label: string, r: RowEntry | undefined, fallback?: string): { label: string; value: string; tone: CardTone } => {
    if (fallback) return { label, value: fallback, tone: /not required|no\b/i.test(fallback) ? "muted" : "info" };
    const a = answerOf(r);
    return { label, value: a.label, tone: a.tone };
  };
  const countChip = (label: string, n: number, none: RowEntry | undefined): { label: string; value: string; tone: CardTone } =>
    n > 0 ? { label, value: String(n), tone: "info" } : none && (none.state === "no" || none.state === "na") ? { label, value: "None", tone: "muted" } : { label, value: "not stated", tone: "muted" };
  const glanceChips = [
    chip("App release", tryRow(v, "app_release")),
    chip("DB change", tryRow(v, "db_queries")),
    chip("Index", tryRow(v, "db_index")),
    countChip("Configs", cfgCount, cfgRow),
    countChip("Services", svc.entries.length, tryRow(v, "services_deploy")),
    v.services.downtime.length ? { label: "Downtime", value: "Yes", tone: "danger" as const } : { label: "Downtime", value: "none stated", tone: "muted" as const },
    chip("Bundle SDK", tryRow(v, "bundle_sdk"), sdk ? sentenceCase(sdk.replace(/^Bundle SDK build:\s*/i, "")) : tryRow(v, "bundle_sdk")?.state === "yes" ? "Required" : tryRow(v, "bundle_sdk")?.state === "no" || tryRow(v, "bundle_sdk")?.state === "na" ? "Not required" : undefined),
    chip("Old data fix", tryRow(v, "previous_data")),
    chip("Backward-compat", tryRow(v, "beta_compat")),
  ];
  const glance: Card = {
    id: "glance",
    title: CARD_TITLES.glance,
    about: "The verdict and the nine facts to check first.",
    hint: "",
    blocks: [{ kind: "verdict", verdict: st.verdict, tone: verdictTone, reason: st.reason, what: whatP }, { kind: "facts", chips: glanceChips }],
  };

  cards.push(glance);
  cards.push({ id: "deploy", title: CARD_TITLES.deploy, about: "Each service once, and what to do with it.", hint: svc.entries.length ? plural(svc.entries.length, "service") : "", blocks: deployBlocks });
  cards.push({ id: "config", title: CARD_TITLES.config, about: "Settings to add or change, with their value.", hint: cfgCount ? plural(cfgCount, "key") : "", blocks: cfgBlocks });
  cards.push({ id: "data", title: CARD_TITLES.data, about: "Old-data fix, database changes and indexes.", hint: "", blocks: dataBlocks });
  cards.push({ id: "app", title: CARD_TITLES.app, about: "App changes, old apps and old data.", hint: "", blocks: appBlocks });
  cards.push({ id: "testing", title: CARD_TITLES.testing, about: "What to test, and what is easy to miss.", hint: missed.length ? `${missed.length} easy to miss` : "", blocks: testBlocks });
  cards.push({ id: "order", title: CARD_TITLES.order, about: "Do these in this order.", hint: stepsKept.length ? plural(stepsKept.length, "step") : "", blocks: orderBlocks });
  cards.push({ id: "rollback", title: CARD_TITLES.rollback, about: "How to go back.", hint: "", blocks: rollbackBlocks });
  cards.push({ id: "verify", title: CARD_TITLES.verify, about: "Check these once it is live.", hint: verify.length ? plural(verify.length, "check") : "", blocks: verifyBlocks });
  cards.push({ id: "open", title: CARD_TITLES.open, about: "What is not known yet, who answers, and what the reviewer found.", hint: [qRows.length ? plural(qRows.length, "question") : "", rRows.length ? plural(rRows.length, "risk") : ""].filter(Boolean).join(" · "), blocks: openBlocks });
  cards.push({ id: "prs", title: CARD_TITLES.prs, about: "The pull requests, and those not in this release.", hint: [prRows.length ? `${prRows.length} merged` : "", notReleasedCount ? `${notReleasedCount} not released` : ""].filter(Boolean).join(" · "), blocks: prBlocks });
  cards.push({ id: "release", title: CARD_TITLES.release, about: "Every row of the release page, in its order.", hint: `${v.rows.length} rows`, blocks: releaseBlocks });
  for (const c of cards) c.blocks = c.blocks.map(pruneEmptyColumns);
  return cards;
}

/** "channelkart: M. Against ...: ... kpi-dashboard: M, 22 files ... slake-reporting-config: S. Re-test: M" -> one point per repo, then the re-test. */
export function repoClauses(t: string, dedupe: Deduper): Plain {
  const base = plainify(t, { maxLead: 100_000, maxBullets: 100 });
  const text0 = plainLines(base).map((l) => (/[.;:)]$/.test(l) ? l : `${l}.`)).join(" ");
  const marks = [...text0.matchAll(/(?:^|\s)([a-z][\w.-]{2,}):\s(?=(?:XS|S|M|L|XL)\b)/g)].map((m) => ({ at: (m.index ?? 0) + (m[0].startsWith(" ") ? 1 : 0) }));
  const retest = text0.search(/\bRe-test:\s/);
  if (marks.length < 2) return plainify(t, { dedupe });
  const cuts = [...marks.map((m) => m.at), ...(retest > marks[marks.length - 1].at ? [retest] : [])];
  const clauses = cuts.map((c, i) => text0.slice(c, i + 1 < cuts.length ? cuts[i + 1] : text0.length).trim().replace(/[.;]+$/, "")).filter(Boolean);
  const kept = clauses.filter((c) => !dedupe.has(c));
  for (const c of kept) dedupe.add(c);
  return { lead: "", bullets: kept.slice(0, 4), more: kept.slice(4), pointers: base.pointers };
}

const isDash = (c: Cell): boolean => c.kind === "text" && c.text === "—";

/** A column whose every cell is "—" says nothing: it is left out (a table keeps at least two columns). */
function pruneEmptyColumns(b: Block): Block {
  if (b.kind !== "table" || b.columns.length <= 2 || b.rows.length === 0) return b;
  const keep = b.columns.map((_, i) => i < 2 || b.rows.some((r) => !isDash(r.cells[i])));
  if (keep.every(Boolean)) return b;
  const widths = b.widths ? b.widths.filter((_, i) => keep[i]) : undefined;
  if (widths) {
    const total = widths.reduce((n, w) => n + parseFloat(w), 0);
    for (let i = 0; i < widths.length; i++) widths[i] = `${Math.round((parseFloat(widths[i]) / total) * 100)}%`;
  }
  return { ...b, columns: b.columns.filter((_, i) => keep[i]), widths, rows: b.rows.map((r) => ({ ...r, cells: r.cells.filter((_, i) => keep[i]) })) };
}

function rowLabelAt(v: JiraChecklistView, n: number): string {
  const r = v.rows.find((x) => x.n === n);
  return r ? r.label.replace(/\s*\?$/, "") : "";
}

/** "channelkart#1156 CAV-7293-collections-order-source 12c2cd9153 17 Nov batching fixes" -> "channelkart#1156 — batching fixes (CAV-7293-collections-order-source, 12c2cd9153, 17 Nov)". Without a commit it stays as written. */
function prLine(raw: string): string {
  const m = /^(\S+#\d+)\s+(\S+)\s+([0-9a-f]{7,40})\s+(?:(\d{1,2} [A-Z][a-z]{2})\s+)?([\s\S]*)$/.exec(raw.trim());
  if (!m) return raw;
  const meta = [m[2], m[3].slice(0, 10), m[4]].filter(Boolean).join(", ");
  return m[5] ? `${m[1]} — ${m[5]} (${meta})` : `${m[1]} (${meta})`;
}

const TRAILING_PAREN = /\s*\(([^()]*(?:approv|merged|self-merged)[^()]*)\)\s*$/i;

/** One PR row: PR | Base (+ commit) | What it does | Approval. */
function prRow(p: PrRow, genericApprover: string | null): TableRow {
  let note = p.note ?? "";
  let date: string | null = null;
  const dm = /^(\d{1,2} [A-Z][a-z]{2}(?: \d{4})?)\s+/.exec(note);
  if (dm) {
    date = dm[1];
    note = note.slice(dm[0].length);
  }
  let approval: { text: string; tone: CardTone } | null = null;
  let by = "";
  const am = TRAILING_PAREN.exec(note);
  if (am) {
    const a = am[1];
    note = note.slice(0, am.index).trim();
    const who = /\bby\s+([A-Za-z0-9_.-]+(?: the author)?)/i.exec(a)?.[1] ?? "";
    by = who;
    if (/no (formal )?approval|self-merged|not approved/i.test(a)) approval = { text: "No approval", tone: "warn" };
    else if (/approved/i.test(a)) approval = { text: "Approved", tone: "ok" };
    else approval = { text: "Merged", tone: "info" };
  }
  if (p.noApproval) approval = { text: "No approval", tone: "warn" };
  else if (!approval && genericApprover) {
    approval = { text: "Approved", tone: "ok" };
    by = genericApprover;
  }
  const stack: Cell[] = [];
  if (approval) stack.push({ kind: "chips", chips: [{ text: approval.text, tone: approval.tone }] });
  const small = [by ? `by ${by}` : "", date ? `merged ${date}` : ""].filter(Boolean).join(", ");
  if (small) stack.push(text(small, { muted: true }));
  const what = plainify(note, { maxLead: 120 });
  const base = [p.branch ?? "", p.commit ? p.commit.slice(0, 10) : ""].filter(Boolean);
  return {
    id: `pr:${p.pr}`,
    cells: [
      { kind: "text", text: p.pr, strong: true },
      base.length ? { kind: "stack", cells: [text(base[0]), ...(base[1] ? [text(base[1], { muted: true })] : [])] } : text("—", { muted: true }),
      isEmptyPlain(what) ? text("—", { muted: true }) : plainCell(what),
      stack.length ? { kind: "stack", cells: stack } : text("—", { muted: true }),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// text for the clipboard
// ---------------------------------------------------------------------------------------------

export function cellText(c: Cell): string {
  switch (c.kind) {
    case "text":
      return c.text;
    case "plain":
      return plainOneLine(c.plain);
    case "answer":
      return c.label || "";
    case "chips":
      return c.chips.map((x) => x.text).join(" + ");
    case "env":
      return c.values.map((x) => `${x.env}: ${x.value ?? "not set"}`).join(", ");
    case "stack":
      return c.cells.map(cellText).filter(Boolean).join(", ");
  }
}

/** The lines of one table row: "- A — B — C" and, under it, the bullets of any cell that has them. A numbered table prints "7. B — C" (the number is the row's first cell). */
function rowLines(row: TableRow, numbered: boolean): string[] {
  const cells = numbered ? row.cells.slice(1) : row.cells;
  const head: string[] = [];
  const nested: string[] = [];
  for (const c of cells) {
    if (c.kind === "plain" && (c.plain.bullets.length || c.plain.more.length)) {
      if (c.plain.lead) head.push(c.plain.lead);
      for (const b of [...c.plain.bullets, ...c.plain.more]) nested.push(`    - ${b}`);
    } else {
      const t = cellText(c);
      if (t && t !== "—") head.push(t);
    }
  }
  const prefix = numbered ? `${cellText(row.cells[0])}. ` : "- ";
  return [`${prefix}${head.join(" — ")}`.trimEnd(), ...nested];
}

function blockLines(b: Block): string[] {
  switch (b.kind) {
    case "verdict": {
      const out = [`Verdict: ${b.verdict}${b.reason.lead ? ` ${b.reason.lead}` : ""}`];
      for (const x of [...b.reason.bullets, ...b.reason.more]) out.push(`  - ${x}`);
      if (b.what && !isEmptyPlain(b.what)) {
        out.push(`What it does: ${b.what.lead}`);
        for (const x of [...b.what.bullets, ...b.what.more]) out.push(`  - ${x}`);
      }
      return out;
    }
    case "facts":
      return [b.chips.map((c) => `${c.label}: ${c.value}`).join(" | ")];
    case "table": {
      if (b.columns.length === 1) return b.rows.map((r) => `- ${cellText(r.cells[0])}`);
      const numbered = b.label === "Release checklist";
      return b.rows.flatMap((r) => rowLines(r, numbered));
    }
    case "list": {
      const out: string[] = [];
      if (b.title) out.push(`${b.title}:`);
      b.items.forEach((p, i) => {
        const lines = plainCopy(p);
        lines.forEach((l, j) => out.push(j === 0 ? `${b.ordered ? `${i + 1}.` : "-"} ${l.trimStart()}` : `  ${l}`));
      });
      return out;
    }
    case "note":
      return [b.text];
  }
}

/** One card as text for the clipboard, headed with the Jira key and the card's title. */
export function cardText(jira: string, card: Card): string {
  const L: string[] = [`${jira} — ${card.title}`];
  for (const b of card.blocks) L.push(...blockLines(b));
  return L.join("\n");
}

/** Every card in order as one text, headed with the Jira key and the environment. */
export function cardsText(jira: string, environment: string, cards: readonly Card[]): string {
  return [`Checklist of ${jira} for ${environment.toUpperCase()}`, ...cards.map((c) => `\n${cardText(jira, c)}`)].join("\n");
}

/** Every sentence shown by the cards, for the "nothing is said twice" checks. */
export function cardSentences(cards: readonly Card[]): string[] {
  const out: string[] = [];
  const cellS = (c: Cell): void => {
    if (c.kind === "plain") out.push(...plainLines(c.plain));
    else if (c.kind === "stack") c.cells.forEach(cellS);
  };
  for (const card of cards)
    for (const b of card.blocks) {
      if (b.kind === "table") b.rows.forEach((r) => r.cells.forEach(cellS));
      else if (b.kind === "list") b.items.forEach((p) => out.push(...plainLines(p)));
      else if (b.kind === "verdict") out.push(...plainLines(b.reason), ...(b.what ? plainLines(b.what) : []));
    }
  return out;
}
