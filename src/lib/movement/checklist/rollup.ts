/**
 * The ROLLUP: the Checklist tab's summary (the "union") of every Jira's checklist.
 *
 * The checklist keeps every Jira's lines; the rollup folds them into ONE entry per thing a devops
 * person acts on ("Deploy Channel Kart - 3 Jiras", "App release REQUIRED", one entry per config key),
 * with a badge, one crisp line and the Jiras behind it. Union semantics: every Jira's answer is
 * considered and nothing is dropped; "required / yes / not done" wins over "not required / no / done".
 *
 * Pure and deterministic (no network, no clock): this layer is always available and is what the
 * optional AI summary (summary-ai.ts) is allowed to reword, never to overrule.
 */
import type { ParsedRecord, RecordFacts, RowState } from "../record";
import { buildChecklist, cmpJiraKey, effectiveRecords, ROW_SECTION, ROW_WORD, YES_FIRST_IDS } from "./build";
import { isNoRestart, serviceParts, splitNote } from "./services";
import { branchesCompatible, canonicalService, cap, isPattern, normBranch, normalizeSqlPath, repoService, sig, tidy, valueSig } from "./normalize";
import type { Checklist, ChecklistInput, ChecklistItem, EnvInfo, ItemSeverity, SectionId } from "./types";
import { SECTIONS } from "./types";

// ---------------------------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------------------------

export type Badge = "REQUIRED" | "NOT REQUIRED" | "DONE" | "NOT DONE" | "UNKNOWN" | "YES" | "NO" | "ATTENTION" | "INFO";
export const BADGES: readonly Badge[] = ["REQUIRED", "NOT REQUIRED", "DONE", "NOT DONE", "UNKNOWN", "YES", "NO", "ATTENTION", "INFO"];
export const SEVERITIES: readonly ItemSeverity[] = ["info", "warn", "blocker"];

export interface RowCounts {
  done: number;
  notDone: number;
  unknown: number;
  notRequired: number;
  yes: number;
  no: number;
}

export interface RollupDetail {
  text: string;
  jiras: string[];
}

export interface RollupEntry {
  /** Stable within its section (never contains a comment id). */
  key: string;
  /** "Channel Kart", "App release", "DB changes", a config key. <= 80 chars. */
  title: string;
  badge: Badge;
  severity: ItemSeverity;
  /** ONE plain outcome sentence that adds to the title (kept in whole sentences; "" when the title already is the whole text). */
  line: string;
  /** Jira keys behind the entry (at most 40; `moreJiras` counts the rest). */
  jiras: string[];
  moreJiras?: number;
  counts?: RowCounts;
  /** Secondary lines, shown on expand. */
  details?: RollupDetail[];
  needsAttention?: boolean;
  /** Configs: the per-environment cells and the target environment's value. */
  env?: EnvInfo;
}

export interface RollupSection {
  id: SectionId;
  title: string;
  entries: RollupEntry[];
  /** Entries beyond the cap of 60 (the last entry says so). */
  more?: number;
}

export interface Glance {
  id: string;
  badge: Badge;
  severity: ItemSeverity;
  /** <= 80 chars */
  title: string;
  /** <= 200 chars */
  detail: string;
  jiras: string[];
  /** The rollup entry it points at, when there is one. */
  ref?: { sectionId: SectionId; key: string };
}

export interface RollupHeadline {
  jiras: number;
  prs: number;
  reviewComments: number;
  needAttention: number;
  unknowns: number;
  /** (Jira, release-page row) pairs answered "Not done". */
  notDone: number;
  conflicts: number;
}

export interface Rollup {
  version: 1;
  environment: Checklist["environment"];
  headline: RollupHeadline;
  /** Every Jira of the movement (the only keys a summary may name). */
  jiraKeys: string[];
  atAGlance: Glance[];
  sections: RollupSection[];
}

export const MAX_ROLLUP_ENTRIES = 60;
export const MAX_ROLLUP_JIRAS = 40;
export const MAX_GLANCE = 10;
const LINE_MAX = 400;
const DETAIL_MAX = 1200;
const TITLE_MAX = 80;
const TEXT_TITLE_MAX = 120;

const SEV_RANK: Record<ItemSeverity, number> = { info: 0, warn: 1, blocker: 2 };

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

class JiraSet {
  private s = new Set<string>();
  add(j: string) {
    this.s.add(j);
  }
  get size() {
    return this.s.size;
  }
  list(): string[] {
    return [...this.s].sort(cmpJiraKey);
  }
}

/** "CAV-1, CAV-2, +3": at most 8 keys inline. */
export function inlineJiras(keys: string[]): string {
  return keys.length <= 8 ? keys.join(", ") : `${keys.slice(0, 8).join(", ")}, +${keys.length - 8}`;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** "CAV-1, CAV-2, CAV-3 +4 more": at most 4 keys are named (the Jiras column and the expanded entry hold the full list). */
export { serviceParts } from "./services";

export function fewJiras(keys: string[], max = 4): string {
  return keys.length <= max ? keys.join(", ") : `${keys.slice(0, max - 1).join(", ")} +${keys.length - (max - 1)} more`;
}

/**
 * Text kept in whole sentences: when it is longer than `max`, the sentences that fit are kept and the rest is counted ("(+2 more)"),
 * never cut mid-sentence. A single sentence longer than `max` stays whole (the checklist already bounds every text).
 */
export function fitWhole(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const parts = t.split(/(?<=[.!?;])\s+/).filter(Boolean);
  const keep: string[] = [];
  let len = 0;
  for (const p of parts) {
    if (keep.length && len + p.length + 1 > max) break;
    keep.push(p);
    len += p.length + 1;
  }
  const more = parts.length - keep.length;
  return `${keep.join(" ")}${more > 0 ? ` (+${more} more)` : ""}`;
}

/** A title of at most `max` characters that ends at a clause or a word (outside brackets), never with "…". */
export function shortTitle(text: string, max = TITLE_MAX): string {
  const t = text.trim();
  if (t.length <= max) return t;
  let depth = 0;
  let clause = -1;
  let space = -1;
  let closed = -1;
  for (let i = 0; i <= max && i < t.length; i++) {
    const c = t[i];
    if (c === "(") depth++;
    else if (c === ")" && depth > 0) {
      depth--;
      if (depth === 0 && i + 1 >= 30 && (t[i + 1] === " " || i + 1 === t.length)) closed = i + 1;
    } else if (depth === 0) {
      if (c === " ") space = i;
      if (i >= 30 && (t.startsWith("; ", i) || t.startsWith(", ", i) || t.startsWith(" - ", i) || t.startsWith(" — ", i) || t.startsWith(": ", i))) clause = i;
    }
  }
  // a bracket still open at the limit: keep it whole when it closes soon, else stop before it
  if (depth > 0) {
    const close = t.indexOf(")", max);
    if (close >= 0 && close <= max + 40) return t.slice(0, close + 1);
  }
  const at = Math.max(clause, closed) >= 0 ? Math.max(clause, closed) : space > 0 ? space : max;
  return t.slice(0, at).replace(/[\s,;:(-]+$/, "");
}

interface EntryIn {
  /** Longest title (default 80); an entry whose title IS its text may use more. */
  titleMax?: number;
  key: string;
  title: string;
  badge: Badge;
  severity?: ItemSeverity;
  line: string;
  jiras: string[];
  counts?: RowCounts;
  details?: RollupDetail[];
  needsAttention?: boolean;
  env?: EnvInfo;
}

function entry(p: EntryIn): RollupEntry {
  const jiras = [...new Set(p.jiras)].sort(cmpJiraKey);
  const e: RollupEntry = {
    key: p.key,
    title: shortTitle(tidy(p.title, 2000), p.titleMax ?? TITLE_MAX),
    badge: p.badge,
    severity: p.severity ?? "info",
    line: fitWhole(tidy(p.line, 4000), LINE_MAX),
    jiras: jiras.slice(0, MAX_ROLLUP_JIRAS),
  };
  if (jiras.length > MAX_ROLLUP_JIRAS) e.moreJiras = jiras.length - MAX_ROLLUP_JIRAS;
  if (p.counts) e.counts = p.counts;
  if (p.details?.length) {
    const shown = p.details.slice(0, 12).map((d) => ({ text: fitWhole(tidy(d.text, 4000), DETAIL_MAX), jiras: [...d.jiras].sort(cmpJiraKey).slice(0, 12) }));
    if (p.details.length > 12) shown.push({ text: `+${p.details.length - 12} more`, jiras: [] });
    e.details = shown;
  }
  if (p.needsAttention) e.needsAttention = true;
  if (p.env) e.env = p.env;
  return e;
}

/** text -> Jiras, keyed by the comparison form of the text (the first spelling is shown). */
class TextBag {
  private m = new Map<string, { text: string; jiras: JiraSet; sev?: ItemSeverity; label?: string }>();
  add(text: string, jira: string, sev?: ItemSeverity, label?: string) {
    const t = cap(tidy(text, 4000), 1000);
    const k = sig(t, 300) || t;
    if (!k) return;
    let e = this.m.get(k);
    if (!e) this.m.set(k, (e = { text: t, jiras: new JiraSet() }));
    e.jiras.add(jira);
    if (sev && (!e.sev || SEV_RANK[sev] > SEV_RANK[e.sev])) {
      e.sev = sev;
      if (label) e.label = label;
    }
  }
  values() {
    return [...this.m.entries()].map(([k, v]) => ({ k, text: v.text, jiras: v.jiras.list(), sev: v.sev, label: v.label }));
  }
}

const emptyCounts = (): RowCounts => ({ done: 0, notDone: 0, unknown: 0, notRequired: 0, yes: 0, no: 0 });

interface RC {
  jira: string;
  rec: ParsedRecord;
  f: RecordFacts;
  union: boolean;
  repo: string | null;
}

type Named = Map<string, { text: string; jiras: JiraSet }>;
const putNamed = (m: Named, k: string, text: string, jira: string) => {
  let e = m.get(k);
  if (!e) m.set(k, (e = { text, jiras: new JiraSet() }));
  e.jiras.add(jira);
};

// ---------------------------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------------------------

const SECTION_TITLE = new Map(SECTIONS.map((s) => [s.id, s.title] as const));
const ROW_SKIP = new Set(["app_release", "bundle_sdk", "services_deploy", "services_restart"]); // they have their own entries
const STATE_ORDER: RowState[] = ["not_done", "unknown", "done", "yes", "no", "other", "not_required"];
const BADGE_OF: Record<RowState, Badge> = { not_done: "NOT DONE", unknown: "UNKNOWN", done: "DONE", yes: "YES", no: "NO", other: "INFO", not_required: "NOT REQUIRED" };

/** When the title is the text itself and was shortened, the line holds the whole text; when it fits, there is nothing to add. */
const textBeyondTitle = (text: string): string => {
  const title = shortTitle(text, TEXT_TITLE_MAX);
  return text.slice(title.length).replace(/^[\s;,:-]+/, "");
};

/** The owner named in an unknown answer: "(release manager)" -> "release manager". */
const ownerIn = (text: string): string => /\(([^)]{1,40})\)/.exec(text)?.[1].trim() ?? "";

/**
 * What a release-page row says across the Jiras, in one plain sentence that adds to the title: "2 Jiras not done: CAV-7293, CAV-7294 · 3 done · 8 not needed",
 * "13 Jiras still need an answer from release manager". No title echo, no count that the Jiras column already shows.
 */
function rowOutcome(glist: Array<{ state: RowState; text: string; jiras: JiraSet }>, covered: number, total: number, owners: Set<string>): string {
  const byState = new Map<RowState, { jiras: Set<string>; owners: Set<string>; texts: string[] }>();
  for (const g of glist) {
    let e = byState.get(g.state);
    if (!e) byState.set(g.state, (e = { jiras: new Set(), owners: new Set(), texts: [] }));
    for (const j of g.jiras.list()) e.jiras.add(j);
    const o = ownerIn(g.text);
    if (o) e.owners.add(o);
    if (g.text) e.texts.push(g.text);
  }
  const every = (n: number) => n === total && total > 1;
  const parts: string[] = [];
  for (const state of STATE_ORDER) {
    const e = byState.get(state);
    if (!e) continue;
    const js = [...e.jiras].sort(cmpJiraKey);
    const n = js.length;
    if (state === "not_done") parts.push(every(n) ? `Not done in all ${n} Jiras` : `${plural(n, "Jira")} not done: ${fewJiras(js)}`);
    else if (state === "unknown") {
      const who = [...new Map([...e.owners, ...owners].map((o) => [o.trim().toLowerCase(), o.trim()] as const)).values()];
      parts.push(`${every(n) ? `All ${n} Jiras` : plural(n, "Jira")} still ${n === 1 ? "needs" : "need"} an answer${who.length ? ` from ${who.join(", ")}` : ""}`);
    }
    else if (state === "done") parts.push(every(n) ? `Done in all ${n} Jiras` : `${n} done`);
    else if (state === "yes") parts.push(every(n) ? `Yes in all ${n} Jiras` : `${n} yes`);
    else if (state === "no") parts.push(every(n) ? `No in all ${n} Jiras` : `${n} no`);
    else if (state === "not_required") parts.push(every(n) ? `Not needed in all ${n} Jiras` : `${n} not needed`);
    else {
      // free-text answers: say them when there is one short answer, else count them
      const texts = [...new Set(e.texts)].filter((t) => !/^see\b/i.test(t));
      if (texts.length === 1 && texts[0].length <= 160) parts.push(`${texts[0]}${every(n) ? "" : ` (${fewJiras(js)})`}`);
      else if (texts.length > 1) parts.push(`${plural(n, "Jira")} answered in their own words`);
    }
  }
  void covered;
  return parts.join(" · ");
}

export function buildRollup(input: ChecklistInput, opts: { checklist?: Checklist } = {}): Rollup {
  const cl = opts.checklist ?? buildChecklist(input);
  const env = input.environment;
  const included = input.jiras.filter((j) => j.included).sort((a, b) => cmpJiraKey(a.key, b.key));
  const jiraKeys = included.map((j) => j.key);

  const rcs: RC[] = [];
  for (const j of included) {
    for (const { rec } of effectiveRecords(j).recs) rcs.push({ jira: j.key, rec, f: rec.facts, union: rec.marker.scope === "union", repo: rec.marker.repo });
  }

  /** row id -> who must answer, from the records' unknown items ("release manager", "devops") */
  const unknownOwners = new Map<string, Set<string>>();
  for (const c of rcs) for (const u of c.rec.unknowns) if (u.rowId && u.owner) (unknownOwners.get(u.rowId) ?? unknownOwners.set(u.rowId, new Set()).get(u.rowId)!).add(u.owner.trim());

  const sections = new Map<SectionId, RollupEntry[]>(SECTIONS.map((s) => [s.id, []]));
  const add = (id: SectionId, e: RollupEntry) => (sections.get(id) as RollupEntry[]).push(e);

  // --- release-page rows, per Jira ------------------------------------------------------------
  interface RowInfo {
    id: string;
    n: number;
    label: string;
    section: SectionId;
    perJira: Map<string, Map<RowState, Set<string>>>;
  }
  const rows = new Map<string, RowInfo>();
  for (const c of rcs) {
    for (const r of c.f.releaseRows ?? []) {
      const id = r.id ?? `n${r.n}:${sig(r.label)}`;
      let info = rows.get(id);
      if (!info) rows.set(id, (info = { id, n: r.n, label: cap(tidy(r.label, 120), 120), section: (r.id ? ROW_SECTION[r.id] : undefined) ?? "header", perJira: new Map() }));
      let st = info.perJira.get(c.jira);
      if (!st) info.perJira.set(c.jira, (st = new Map()));
      let texts = st.get(r.state);
      if (!texts) st.set(r.state, (texts = new Set()));
      const t = cap(tidy(r.state === "other" ? r.answer : r.text, 4000), 1000);
      if (t) texts.add(t);
    }
  }
  /** A Jira's own answers to a row: known ones win over its own unknown. */
  const effStates = (info: RowInfo, jira: string): Array<[RowState, Set<string>]> => {
    const st = info.perJira.get(jira);
    if (!st) return [];
    const all = [...st.entries()];
    const known = all.filter(([s]) => s !== "unknown");
    return known.length ? known : all;
  };
  const rowStatesOf = (id: string): Map<string, RowState[]> => {
    const out = new Map<string, RowState[]>();
    const info = rows.get(id);
    if (!info) return out;
    for (const j of info.perJira.keys()) out.set(j, effStates(info, j).map(([s]) => s));
    return out;
  };

  // database topics: the four release-page rows are the ONE place of those answers; all "no" = one "No database change" line, and the UI index db row
  // shows only when some Jira says more than "no"
  const DB_ROW_IDS = new Set(["previous_data", "db_queries", "db_index", "ui_indexdb"]);
  const isNone = (state: RowState, texts: Iterable<string>) => state === "no" || state === "not_required" || (state === "done" && /^(none|nothing)\b/i.test([...texts].join(" ").trim()));
  const rowAllNone = (info: RowInfo) => [...info.perJira.values()].every((st) => [...st.entries()].every(([state, texts]) => isNone(state, texts)));
  const dbInfos = [...rows.values()].filter((i) => DB_ROW_IDS.has(i.id));
  const dbAllNo = dbInfos.length > 0 && dbInfos.every(rowAllNone);
  const dbNoneJiras = new JiraSet();
  let notDonePairs = 0;
  const notReqBySection = new Map<SectionId, Array<{ label: string; jiras: string[] }>>();
  for (const info of [...rows.values()].sort((a, b) => a.n - b.n || (a.id < b.id ? -1 : 1))) {
    if (ROW_SKIP.has(info.id)) continue;
    if (DB_ROW_IDS.has(info.id) && (dbAllNo || (info.id === "ui_indexdb" && rowAllNone(info)))) {
      for (const j of info.perJira.keys()) dbNoneJiras.add(j);
      continue;
    }
    const counts = emptyCounts();
    const groups = new Map<string, { state: RowState; text: string; jiras: JiraSet }>();
    const all = new JiraSet();
    for (const j of [...info.perJira.keys()].sort(cmpJiraKey)) {
      all.add(j);
      for (const [state, texts] of effStates(info, j)) {
        if (state === "done") counts.done++;
        else if (state === "not_done") {
          counts.notDone++;
          notDonePairs++;
        } else if (state === "unknown") counts.unknown++;
        else if (state === "not_required") counts.notRequired++;
        else if (state === "yes") counts.yes++;
        else if (state === "no") counts.no++;
        const t = [...texts].join(" / ");
        const key = `${state}|${sig(t)}`;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { state, text: t, jiras: new JiraSet() }));
        g.jiras.add(j);
      }
    }
    const states = new Set([...groups.values()].map((g) => g.state));
    if (states.size === 1 && states.has("not_required")) {
      const l = notReqBySection.get(info.section) ?? [];
      l.push({ label: info.label, jiras: all.list() });
      notReqBySection.set(info.section, l);
      continue;
    }
    const worst = (YES_FIRST_IDS.has(info.id) ? (["yes", "not_done", "unknown", "done", "no", "other", "not_required"] as RowState[]) : STATE_ORDER).find((s) => states.has(s) && s !== "not_required") ?? "not_required";
    // any Jira with an open answer keeps the entry in the attention view, even when "yes" leads the wording and the badge
    const open = (states.has("not_done") || states.has("unknown")) && (info.id !== "configs_prod" || env === "prod");
    const glist = [...groups.values()].sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
    const say = (g: { state: RowState; text: string }) => (g.state === "other" ? g.text : g.state === "unknown" ? `Not known yet${ownerIn(g.text) ? ` — ${ownerIn(g.text)} to confirm` : ""}` : `${ROW_WORD[g.state]}${g.text ? ` ${g.text}` : ""}`);
    const line = all.size === 1 ? glist.map(say).join("; ") : rowOutcome(glist, all.size, jiraKeys.length, unknownOwners.get(info.id) ?? new Set());
    add(
      info.section,
      entry({
        key: `row:${info.id}`,
        title: info.label,
        badge: BADGE_OF[worst],
        severity: open ? "warn" : "info",
        line,
        jiras: all.list(),
        counts,
        needsAttention: open,
        details: glist.map((g) => ({ text: say(g), jiras: g.jiras.list() })),
      }),
    );
  }
  for (const [section, list] of notReqBySection) {
    const all = new JiraSet();
    for (const l of list) for (const j of l.jiras) all.add(j);
    add(section, entry({ key: `notreq:${section}`, title: "Not required", badge: "NOT REQUIRED", line: list.map((l) => l.label).join(", "), jiras: all.list(), details: list.map((l) => ({ text: l.label, jiras: l.jiras })) }));
  }

  // --- 1 header: status of every Jira, Jiras held back -----------------------------------------
  {
    const byWord = new Map<string, JiraSet>();
    const statusTexts = new Map<string, Map<string, JiraSet>>();
    for (const c of rcs) {
      const w = (c.union ? c.f.statusWord : null) ?? c.rec.status;
      if (!w) continue;
      const st = tidy(c.rec.statusText ?? "", 1000);
      if (st) {
        let m = statusTexts.get(w);
        if (!m) statusTexts.set(w, (m = new Map()));
        let js = m.get(st);
        if (!js) m.set(st, (js = new JiraSet()));
        js.add(c.jira);
      }
      let s = byWord.get(w);
      if (!s) byWord.set(w, (s = new JiraSet()));
      s.add(c.jira);
    }
    for (const w of ["BLOCKED", "HELD", "PARTIAL", "READY"]) {
      const s = byWord.get(w);
      if (!s) continue;
      if (!statusTexts.has(w)) statusTexts.set(w, new Map());
      add(
        "header",
        entry({
          key: `status:${w}`,
          title: `${w[0]}${w.slice(1).toLowerCase()} reviews`,
          badge: w === "READY" ? "DONE" : "ATTENTION",
          severity: w === "BLOCKED" ? "blocker" : w === "READY" ? "info" : "warn",
          line: w === "READY" ? "Ready to release as reviewed" : w === "PARTIAL" ? "Reviewed only in part" : "Not ready to release as reviewed",
          details: [...statusTexts.get(w)!.entries()].map(([t, js]) => ({ text: t, jiras: js.list() })),
          jiras: s.list(),
          needsAttention: w === "BLOCKED" || w === "HELD",
        }),
      );
    }
    if (cl.held.length) {
      add("header", entry({ key: "held", title: "Not in this movement", badge: "INFO", line: "Left out of this movement (not ticked)", jiras: cl.held.map((h) => h.jira), details: cl.held.map((h) => ({ text: `${h.jira} (${h.readiness})${h.summary ? ` ${h.summary}` : ""}`, jiras: [h.jira] })) }));
    }
  }

  // --- 2 branches: PRs per repo, PRs that are NOT part of the movement -------------------------
  {
    const repos = new Map<string, Named>();
    const notes = { open: new Map() as Named, reverted: new Map() as Named, stack: new Map() as Named, noApproval: new Map() as Named };
    for (const c of rcs) {
      if (c.union) {
        for (const cv of c.f.covers ?? []) {
          let m = repos.get(cv.repo);
          if (!m) repos.set(cv.repo, (m = new Map()));
          putNamed(m, `${cv.pr}`, `#${cv.pr}${cv.branch ? ` ${cv.branch}` : ""}${cv.sha ? ` ${cv.sha}` : ""}${cv.note ? ` ${cv.note}` : ""}`, c.jira);
          if (/no formal approval/i.test(cv.approval ?? "")) putNamed(notes.noApproval, `${cv.repo}#${cv.pr}`, `${cv.repo}#${cv.pr}`, c.jira);
        }
      } else if (c.repo && c.rec.marker.pr !== null) {
        let m = repos.get(c.repo);
        if (!m) repos.set(c.repo, (m = new Map()));
        putNamed(m, `${c.rec.marker.pr}`, `#${c.rec.marker.pr}${c.f.branch ? ` ${c.f.branch}` : ""}${c.f.prState ? ` [${c.f.prState}]` : ""}`, c.jira);
      }
      for (const [list, m] of [[c.f.stillOpen, notes.open], [c.f.reverted, notes.reverted], [c.f.stackOnly, notes.stack]] as const) {
        for (const cv of list ?? []) putNamed(m, `${cv.repo}#${cv.pr}`, `${cv.repo}#${cv.pr}${cv.note ? ` ${cv.note}` : ""}`, c.jira);
      }
    }
    const groupEntry = (key: string, title: string, attention: boolean, m: Named) => {
      if (!m.size) return;
      const all = new JiraSet();
      for (const v of m.values()) for (const j of v.jiras.list()) all.add(j);
      const names = [...m.keys()].sort();
      add(
        "branches",
        entry({
          key,
          title,
          badge: "ATTENTION",
          severity: "warn",
          needsAttention: attention,
          line: `${plural(m.size, "PR")}: ${fewJiras(names, 5)}`,
          jiras: all.list(),
          details: [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => ({ text: v.text.startsWith(k) ? v.text : `${k} ${v.text}`, jiras: v.jiras.list() })),
        }),
      );
    };
    groupEntry("stillopen", "Still open (NOT released)", true, notes.open);
    groupEntry("reverted", "Reverted (do not deploy as features)", false, notes.reverted);
    groupEntry("stackonly", "Merged into stack branches only (nothing released)", false, notes.stack);
    groupEntry("noapproval", "No formal approval", false, notes.noApproval);
    for (const [repo, prs] of [...repos.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const all = new JiraSet();
      for (const v of prs.values()) for (const j of v.jiras.list()) all.add(j);
      add(
        "branches",
        entry({
          key: `repo:${repo}`,
          title: repo,
          badge: "INFO",
          line: `${plural(prs.size, "PR")}: ${fewJiras([...prs.keys()].sort((a, b) => Number(a) - Number(b)).map((k) => `#${k}`), 6)}`,
          jiras: all.list(),
          details: [...prs.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).slice(0, 40).map(([k, v]) => ({ text: v.text.startsWith("#") ? v.text : `#${k} ${v.text}`, jiras: v.jiras.list() })),
        }),
      );
    }
  }

  // --- 3 prod branch: one per repo --------------------------------------------------------------
  {
    const repos = new Map<string, { values: Map<string, { text: string; jiras: JiraSet }>; knownBranch: boolean; jiras: JiraSet }>();
    for (const c of rcs) {
      const pb = c.f.prodBranch;
      if (!pb && !c.f.prodBranches?.length) continue;
      const repo = c.repo ?? "(repo not named)";
      let r = repos.get(repo);
      if (!r) repos.set(repo, (r = { values: new Map(), knownBranch: false, jiras: new JiraSet() }));
      r.jiras.add(c.jira);
      const list = c.f.prodBranches?.length ? c.f.prodBranches : pb?.branch ? [pb.branch] : [];
      for (const b of list) {
        const v = normBranch(b);
        if (!v) continue;
        let e = r.values.get(v.toLowerCase());
        if (!e) r.values.set(v.toLowerCase(), (e = { text: v, jiras: new JiraSet() }));
        e.jiras.add(c.jira);
        if (!(pb?.unknown && isPattern(v))) r.knownBranch = true;
      }
    }
    for (const [repo, r] of [...repos.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const vals = [...r.values.values()];
      let incompatible = false;
      for (let i = 0; i < vals.length && i < 20; i++) for (let k = i + 1; k < vals.length && k < 20; k++) if (!branchesCompatible(vals[i].text, vals[k].text)) incompatible = true;
      const store = repoService(repo)?.key === "flutter app (sfa)";
      const unconfirmed = env === "prod" && !r.knownBranch && !store;
      const attention = incompatible || unconfirmed;
      add(
        "prodBranch",
        entry({
          key: `prod:${repo}`,
          title: repo,
          badge: attention ? "ATTENTION" : "INFO",
          severity: attention ? "warn" : "info",
          needsAttention: attention,
          line: incompatible ? `Two different prod branches: ${vals.map((v) => v.text).join(" vs ")}` : store && !vals.length ? "Built as a store release" : vals.length ? `Prod branch: ${vals.map((v) => v.text).join(" / ")}${unconfirmed ? " (not confirmed)" : ""}` : "Prod branch not stated",
          jiras: r.jiras.list(),
          details: vals.map((v) => ({ text: v.text, jiras: v.jiras.list() })),
        }),
      );
    }
    for (const b of cl.scope.branches) {
      const mismatch = cl.conflicts.some((c) => c.kind === "branch_mismatch" && c.itemKey === `pick:${b.repo}`);
      add("prodBranch", entry({ key: `pick:${b.repo}:${b.branch}`, title: `Picked branch: ${b.repo}`, badge: mismatch ? "ATTENTION" : "INFO", severity: mismatch ? "warn" : "info", needsAttention: mismatch, line: `You picked ${b.branch}${mismatch ? " (differs from the record's prod branch)" : ""}`, jiras: [] }));
    }
  }

  // --- 4 deploy: one entry per service; Bundle SDK build ----------------------------------------
  {
    const svcs = new Map<string, { name: string; cc: boolean; rank: number; jiras: JiraSet; notes: Map<string, JiraSet> }>();
    for (const c of rcs) {
      for (const s of (c.f.deploy ?? []).flatMap(serviceParts)) {
        const svc = canonicalService(s.name);
        let e = svcs.get(svc.key);
        if (!e) svcs.set(svc.key, (e = { name: svc.name, cc: svc.cc, rank: svc.rank, jiras: new JiraSet(), notes: new Map() }));
        e.jiras.add(c.jira);
        const note = splitNote(s.note).note;
        if (note) {
          let n = e.notes.get(note);
          if (!n) e.notes.set(note, (n = new JiraSet()));
          n.add(c.jira);
        }
      }
    }
    for (const e of [...svcs.values()].sort((a, b) => a.rank - b.rank || (a.name < b.name ? -1 : 1))) {
      const js = e.jiras.list();
      add("deploy", entry({ key: `svc:${e.name.toLowerCase()}`, title: e.name, badge: "INFO", line: `Deploy${e.notes.size ? ` — ${[...e.notes.keys()][0]}` : ""}`, jiras: js, details: [...e.notes.entries()].map(([t, s]) => ({ text: t, jiras: s.list() })) }));
    }
    // bundle SDK: required if ANY Jira says so
    const yes = new JiraSet();
    const no = new JiraSet();
    const unk = new JiraSet();
    const rs = rowStatesOf("bundle_sdk");
    for (const j of jiraKeys) {
      const states = new Set<string>();
      for (const c of rcs) if (c.jira === j && c.f.bundleSdkBuild) states.add(c.f.bundleSdkBuild);
      for (const s of rs.get(j) ?? []) states.add(s === "yes" ? "yes" : s === "no" ? "no" : s === "unknown" ? "unknown" : "");
      if (states.has("yes")) yes.add(j);
      else if (states.has("no")) no.add(j);
      else if (states.has("unknown")) unk.add(j);
    }
    if (yes.size || no.size || unk.size) {
      const req = yes.size > 0;
      const unsure = !req && !no.size;
      add(
        "deploy",
        entry({
          key: "sdk",
          title: "Bundle SDK build",
          badge: req ? "REQUIRED" : no.size ? "NOT REQUIRED" : "UNKNOWN",
          severity: req || unsure ? "warn" : "info",
          needsAttention: unsure,
          line: req ? `Required by ${yes.size === jiraKeys.length && yes.size > 1 ? `all ${yes.size} Jiras` : fewJiras(yes.list())}${no.size ? ` · ${no.size} not needed` : ""}` : no.size ? "Not needed" : `Not known yet: ${fewJiras(unk.list())}`,
          jiras: [...yes.list(), ...no.list(), ...unk.list()],
          details: [yes.size ? { text: "Required", jiras: yes.list() } : null, no.size ? { text: "Not required", jiras: no.list() } : null, unk.size ? { text: "Unknown", jiras: unk.list() } : null].filter((d): d is RollupDetail => d !== null),
        }),
      );
    }
  }

  // --- 5 restart: one entry per service, downtime if ANY Jira says yes --------------------------
  {
    const svcs = new Map<string, { name: string; rank: number; jiras: JiraSet; yes: JiraSet; no: JiraSet; notes: Map<string, JiraSet> }>();
    const get = (key: string, name: string, rank: number) => {
      let e = svcs.get(key);
      if (!e) svcs.set(key, (e = { name, rank, jiras: new JiraSet(), yes: new JiraSet(), no: new JiraSet(), notes: new Map() }));
      return e;
    };
    const none = new JiraSet();
    for (const c of rcs) {
      for (const s of (c.f.restart ?? []).flatMap(serviceParts)) {
        if (isNoRestart(s.note)) continue; // "Bundle: no separate restart": not restarted
        const svc = canonicalService(s.name);
        const e = get(svc.key, svc.name, svc.rank);
        e.jiras.add(c.jira);
        const note = splitNote(s.note).note;
        if (note) {
          let n = e.notes.get(note);
          if (!n) e.notes.set(note, (n = new JiraSet()));
          n.add(c.jira);
        }
      }
      if (c.f.restartNone) none.add(c.jira);
      if (c.f.downtime === "yes" || c.f.downtime === "no") {
        const targets = c.f.restart?.length ? c.f.restart.flatMap(serviceParts).map((s) => canonicalService(s.name)) : [c.repo ? repoService(c.repo) : null].filter((x): x is NonNullable<typeof x> => !!x);
        for (const t of targets) get(t.key, t.name, t.rank)[c.f.downtime].add(c.jira);
      }
    }
    for (const e of [...svcs.values()].sort((a, b) => a.rank - b.rank || (a.name < b.name ? -1 : 1))) {
      if (!e.jiras.size && !e.yes.size) continue; // downtime "no" of a service nobody restarts: nothing to show
      const dt = e.yes.size ? `Downtime if ${fewJiras(e.yes.list())}` : e.no.size ? "No downtime" : "";
      const first = [...e.notes.keys()][0] ?? "";
      const all = new JiraSet();
      for (const j of [...e.jiras.list(), ...e.yes.list()]) all.add(j);
      add(
        "restart",
        entry({
          key: `restart:${e.name.toLowerCase()}`,
          title: e.name,
          badge: e.yes.size ? "ATTENTION" : "INFO",
          severity: e.yes.size ? "warn" : "info",
          needsAttention: e.yes.size > 0,
          line: ["Restart", first ? `— ${first}` : ""].filter(Boolean).join(" ") + (dt ? `. ${dt}` : ""),
          jiras: all.list(),
          details: [...e.notes.entries()].map(([t, js]) => ({ text: t, jiras: js.list() })),
        }),
      );
    }
    if (!svcs.size && none.size) add("restart", entry({ key: "restart:none", title: "No restart", badge: "INFO", line: "Nothing to restart", jiras: none.list() }));
  }

  // --- 6 app release: ONE entry, REQUIRED if any Jira requires it -------------------------------
  {
    const req = new JiraSet();
    const no = new JiraSet();
    const unk = new JiraSet();
    const rs = rowStatesOf("app_release");
    for (const j of jiraKeys) {
      let r = false;
      let n = false;
      let u = false;
      for (const c of rcs) {
        const a = c.jira === j ? c.f.appRelease : undefined;
        if (!a) continue;
        if (a.applicable === true) r = true;
        else if (a.applicable === false) n = true;
        else u = true;
      }
      for (const s of rs.get(j) ?? []) {
        if (s === "not_required") n = true;
        else if (s === "unknown") u = true;
        else r = true;
      }
      if (r) req.add(j);
      else if (n) no.add(j);
      else if (u) unk.add(j);
    }
    if (req.size || no.size || unk.size) {
      const isReq = req.size > 0;
      const unsure = !isReq && !no.size;
      add(
        "appRelease",
        entry({
          key: "app",
          title: "App release",
          badge: isReq ? "REQUIRED" : no.size ? "NOT REQUIRED" : "UNKNOWN",
          severity: isReq || unsure ? "warn" : "info",
          needsAttention: unsure,
          line: isReq ? `Required by ${req.size === jiraKeys.length && req.size > 1 ? `all ${req.size} Jiras` : fewJiras(req.list())}${no.size ? ` · ${no.size} not needed` : ""}${unk.size ? ` · ${unk.size} not known yet` : ""}` : no.size ? `Not needed${unk.size ? ` · ${unk.size} not known yet` : ""}` : `Not known yet: ${fewJiras(unk.list())}`,
          jiras: [...req.list(), ...no.list(), ...unk.list()],
          details: [req.size ? { text: "Required", jiras: req.list() } : null, no.size ? { text: "Not required", jiras: no.list() } : null, unk.size ? { text: "Unknown", jiras: unk.list() } : null].filter((d): d is RollupDetail => d !== null),
        }),
      );
    }
  }

  // --- 7 database: one entry per SQL file / action, "No DB change" when none --------------------
  let sqlCount = 0;
  {
    const sql = new TextBag();
    const actions = new TextBag();
    const noSql = new JiraSet();
    for (const c of rcs) {
      const d = c.f.database;
      if (!d) continue;
      for (const p of d.sqlPaths) {
        const np = normalizeSqlPath(p);
        if (np) sql.add(np, c.jira, "warn");
      }
      for (const it of d.items) actions.add(it, c.jira, d.hasAction ? "warn" : "info");
      if (d.noSql && !d.hasAction && !d.items.length && !d.sqlPaths.length) noSql.add(c.jira);
    }
    for (const v of sql.values()) {
      sqlCount++;
      add("database", entry({ key: `sql:${v.k}`, title: v.text, badge: "REQUIRED", severity: "warn", line: "Run this SQL file by hand", jiras: v.jiras }));
    }
    for (const v of actions.values()) {
      const act = v.sev === "warn";
      add("database", entry({ key: `db:${v.k}`, titleMax: TEXT_TITLE_MAX, title: v.text, badge: act ? "ATTENTION" : "INFO", severity: v.sev ?? "info", needsAttention: act, line: textBeyondTitle(v.text), jiras: v.jiras }));
      if (act) sqlCount++;
    }
    if (!sqlCount && noSql.size) add("database", entry({ key: "db:none", title: "DB changes", badge: "INFO", line: "No database change", jiras: noSql.list() }));
    else if (!sqlCount && dbAllNo && dbNoneJiras.size) add("database", entry({ key: "db:none", title: "DB changes", badge: "INFO", line: "No database change", jiras: dbNoneJiras.list() }));
  }

  // --- 8 configs: one entry per key with the target environment's value -------------------------
  {
    const items: ChecklistItem[] = (cl.sections.find((s) => s.id === "configs")?.items ?? []).filter((i) => i.key.startsWith("cfg:") && i.config);
    for (const it of items) {
      const c = it.config as NonNullable<ChecklistItem["config"]>;
      const e = it.env as EnvInfo | undefined;
      const attention = !!it.needsAttention;
      add(
        "configs",
        entry({
          key: it.key,
          title: c.key,
          badge: attention ? "ATTENTION" : "INFO",
          severity: attention ? "warn" : "info",
          needsAttention: attention,
          line: [e ? `${e.target.toUpperCase()}: ${e.targetValue ?? "not set or not known yet"}` : "", c.default !== undefined ? `default ${c.default}` : ""].filter(Boolean).join(" · ") || "No value stated",
          jiras: it.sources.map((s) => s.jira),
          env: e,
          details: it.conflict ? it.conflict.variants.map((v) => ({ text: v.text, jiras: v.sources.map((s) => s.jira) })) : undefined,
        }),
      );
    }
  }

  // --- 9 roles: one entry per role / designation ------------------------------------------------
  {
    const roles = new Map<string, { title: string; negative: boolean; whats: Map<string, JiraSet>; jiras: JiraSet }>();
    for (const c of rcs) {
      // roles read from the "Different designations" row ARE that row: the row entry is their one place
      const fromRow = (c.f.releaseRows ?? []).some((x) => x.id === "designations") && c.f.roles?.length === 1 && c.f.roles[0].who === null && !c.f.roles[0].negative;
      for (const r of fromRow ? [] : (c.f.roles ?? [])) {
        const k = sig(r.who ?? "negative case", 200).slice(0, 120);
        let e = roles.get(k);
        if (!e) roles.set(k, (e = { title: r.who ?? "Negative case", negative: r.negative, whats: new Map(), jiras: new JiraSet() }));
        e.jiras.add(c.jira);
        const w = tidy(r.what, 1200);
        let s = e.whats.get(w);
        if (!s) e.whats.set(w, (s = new JiraSet()));
        s.add(c.jira);
      }
    }
    for (const [k, e] of roles) {
      const first = [...e.whats.keys()][0] ?? "";
      add("roles", entry({ key: `role:${k}`, title: e.negative ? `Negative: ${e.title}` : e.title, badge: "INFO", line: first, jiras: e.jiras.list(), details: [...e.whats.entries()].map(([t, js]) => ({ text: t, jiras: js.list() })) }));
    }
  }

  // --- 11 order: ONE merged sequence, gates, undo -----------------------------------------------
  {
    const steps = (cl.sections.find((s) => s.id === "order")?.items ?? []).filter((i) => i.key.startsWith("step:") && i.seq !== undefined);
    if (steps.length) {
      const cycle = cl.conflicts.some((c) => c.kind === "order_cycle");
      const all = new JiraSet();
      for (const s of steps) for (const j of s.jiras ?? s.sources.map((x) => x.jira)) all.add(j);
      add(
        "order",
        entry({
          key: "order",
          title: "Deploy order",
          badge: cycle ? "ATTENTION" : "INFO",
          severity: cycle ? "blocker" : "info",
          needsAttention: cycle,
          line: `${plural(steps.length, "step")}, from "${shortTitle(steps[0].text.replace(/\s*\(.*$/, ""), 40)}" to "${shortTitle(steps[steps.length - 1].text.replace(/\s*\(.*$/, ""), 40)}"`,
          jiras: all.list(),
          details: steps.slice(0, 40).map((s) => ({ text: `${s.seq}. ${s.text}`, jiras: s.jiras ?? [] })),
        }),
      );
    }
    const gates = new TextBag();
    const undo = new TextBag();
    for (const c of rcs) {
      for (const g of c.f.order?.gates ?? []) gates.add(g, c.jira);
      if (c.f.order?.rollback) undo.add(c.f.order.rollback, c.jira);
      if (c.f.backwardCompat?.undo) undo.add(c.f.backwardCompat.undo, c.jira);
    }
    for (const g of gates.values()) add("order", entry({ key: `gate:${g.k}`, title: "Gate", badge: "ATTENTION", severity: "warn", line: g.text, jiras: g.jiras }));
    const us = undo.values();
    if (us.length) {
      const all = new JiraSet();
      for (const u of us) for (const j of u.jiras) all.add(j);
      add("order", entry({ key: "undo", title: "Undo / rollback", badge: "INFO", line: us.length === 1 ? us[0].text : "Each Jira describes its own undo", jiras: all.list(), details: us.map((u) => ({ text: u.text, jiras: u.jiras })) }));
    }
  }

  // --- 12 testing: owners per area, likely-to-be-missed -----------------------------------------
  {
    const owners = new Map<string, { area: string | null; owners: Map<string, JiraSet>; jiras: JiraSet }>();
    const missed = new TextBag();
    for (const c of rcs) {
      for (const o of c.f.testOwners ?? []) {
        const k = sig(o.area ?? "", 100);
        let e = owners.get(k);
        if (!e) owners.set(k, (e = { area: o.area, owners: new Map(), jiras: new JiraSet() }));
        e.jiras.add(c.jira);
        let s = e.owners.get(o.owner);
        if (!s) e.owners.set(o.owner, (s = new JiraSet()));
        s.add(c.jira);
      }
      for (const m of c.f.likelyMissed ?? []) missed.add(m.text, c.jira);
    }
    for (const [k, e] of owners) {
      const names = [...e.owners.keys()];
      const unknown = names.length > 0 && names.every((n) => valueSig(n).unknown);
      add("testing", entry({ key: `owner:${k}`, title: `Test owner${e.area ? `: ${e.area}` : ""}`, badge: unknown ? "UNKNOWN" : "INFO", severity: unknown ? "warn" : "info", needsAttention: unknown, line: names.map((n) => (valueSig(n).unknown ? "Not known yet" : n)).join(" / "), jiras: e.jiras.list() }));
    }
    for (const m of missed.values()) add("testing", entry({ key: `missed:${m.k}`, titleMax: TEXT_TITLE_MAX, title: m.text, badge: "INFO", line: textBeyondTitle(m.text), jiras: m.jiras }));
  }

  // --- 13 risks: grouped by text ----------------------------------------------------------------
  {
    const risks = new TextBag();
    for (const c of rcs) {
      const skip = new Set((c.f.likelyMissed ?? []).map((l) => sig(l.text)));
      for (const r of c.f.risks ?? []) {
        if (skip.has(sig(r.text))) continue;
        const sev: ItemSeverity = r.severity === "Blocking" ? "blocker" : r.severity === "Should-fix" ? "warn" : "info";
        risks.add(r.text, c.jira, sev, r.severity ?? undefined);
      }
    }
    for (const r of risks.values()) {
      const sev = r.sev ?? "info";
      add("risks", entry({ key: `risk:${r.k}`, titleMax: TEXT_TITLE_MAX, title: r.text, badge: sev === "info" ? "INFO" : "ATTENTION", severity: sev, needsAttention: sev === "blocker", line: textBeyondTitle(r.text) || (r.label && r.label !== "Note" ? r.label : ""), jiras: r.jiras }));
    }
  }

  // --- 14 verify: de-duplicated -----------------------------------------------------------------
  {
    const v = new TextBag();
    for (const c of rcs) for (const t of c.f.verification ?? []) v.add(t, c.jira);
    for (const e of v.values()) add("verify", entry({ key: `verify:${e.k}`, titleMax: TEXT_TITLE_MAX, title: e.text, badge: "INFO", line: textBeyondTitle(e.text), jiras: e.jiras }));
  }

  // --- order within a section, cap ----------------------------------------------------------------
  const outSections: RollupSection[] = SECTIONS.map((def) => {
    const list = sections.get(def.id) as RollupEntry[];
    const idx = new Map(list.map((e, i) => [e, i]));
    // the merged deploy order comes first in its section; otherwise most severe first
    const pin = (e: RollupEntry) => (def.id === "order" && e.key === "order" ? 0 : 1);
    const sorted = [...list].sort((a, b) => pin(a) - pin(b) || SEV_RANK[b.severity] - SEV_RANK[a.severity] || (idx.get(a) as number) - (idx.get(b) as number));
    const sec: RollupSection = { id: def.id, title: SECTION_TITLE.get(def.id) as string, entries: sorted };
    if (sorted.length > MAX_ROLLUP_ENTRIES) {
      const n = sorted.length - (MAX_ROLLUP_ENTRIES - 1);
      sec.entries = [...sorted.slice(0, MAX_ROLLUP_ENTRIES - 1), entry({ key: `more:${def.id}`, title: "More", badge: "INFO", line: `${n} more entries not shown`, jiras: [] })];
      sec.more = n;
    }
    return sec;
  });

  const rollup: Rollup = {
    version: 1,
    environment: env,
    headline: {
      jiras: included.length,
      prs: cl.stats.prs,
      reviewComments: cl.stats.comments,
      needAttention: outSections.reduce((n, s) => n + s.entries.filter((e) => e.needsAttention).length, 0),
      unknowns: cl.stats.unknowns,
      notDone: notDonePairs,
      conflicts: cl.stats.conflicts,
    },
    jiraKeys,
    atAGlance: [],
    sections: outSections,
  };
  rollup.atAGlance = buildGlance(rollup, cl, sqlCount);
  return rollup;
}

// ---------------------------------------------------------------------------------------------
// at a glance (deterministic, ranked)
// ---------------------------------------------------------------------------------------------

function buildGlance(r: Rollup, cl: Checklist, sqlCount: number): Glance[] {
  const out: Array<{ prio: number; g: Glance }> = [];
  const sec = (id: SectionId) => (r.sections.find((s) => s.id === id) as RollupSection).entries;
  const ref = (sectionId: SectionId, key: string) => ({ sectionId, key });
  const push = (prio: number, g: Glance) => out.push({ prio, g: { ...g, title: shortTitle(g.title), detail: fitWhole(g.detail, 400), jiras: g.jiras.slice(0, MAX_ROLLUP_JIRAS) } });
  const names = (es: RollupEntry[], n = 4) => `${es.slice(0, n).map((e) => e.title).join(", ")}${es.length > n ? `, +${es.length - n}` : ""}`;
  const jirasOf = (es: RollupEntry[]) => [...new Set(es.flatMap((e) => e.jiras))].sort(cmpJiraKey);

  // 1 real blockers: a deploy-order cycle
  const cycle = cl.conflicts.find((c) => c.kind === "order_cycle");
  if (cycle) push(0, { id: "order-cycle", badge: "ATTENTION", severity: "blocker", title: "Deploy order has a cycle", detail: cycle.title, jiras: [...new Set(cycle.variants.flatMap((v) => v.sources.map((s) => s.jira)))].sort(cmpJiraKey), ref: ref("order", "order") });

  // 2 blocked / held reviews
  const bad = sec("header").filter((e) => e.key === "status:BLOCKED" || e.key === "status:HELD");
  if (bad.length) {
    const blocked = bad.some((e) => e.severity === "blocker");
    push(1, { id: "held", badge: "ATTENTION", severity: blocked ? "blocker" : "warn", title: `${plural(jirasOf(bad).length, "Jira")} held or blocked`, detail: bad.map((e) => `${e.title}: ${e.line}`).join("; "), jiras: jirasOf(bad), ref: ref("header", bad[0].key) });
  }
  // 3 prod config values not set
  const cfgs = sec("configs").filter((e) => e.needsAttention && e.key.startsWith("cfg:"));
  if (cfgs.length) push(2, { id: "configs", badge: "ATTENTION", severity: "warn", title: `${plural(cfgs.length, "config")} without a ${r.environment.toUpperCase()} value`, detail: names(cfgs), jiras: jirasOf(cfgs), ref: ref("configs", cfgs[0].key) });
  // 4 app release required
  const app = sec("appRelease").find((e) => e.key === "app");
  if (app && app.badge === "REQUIRED") push(3, { id: "app-release", badge: "REQUIRED", severity: "warn", title: "App release REQUIRED", detail: `${app.details?.find((d) => d.text === "Required")?.jiras.length ?? 1} of ${app.jiras.length} Jiras need a new app release`, jiras: app.details?.find((d) => d.text === "Required")?.jiras ?? app.jiras, ref: ref("appRelease", "app") });
  // 5 restarts / downtime
  const downtime = sec("restart").filter((e) => e.needsAttention);
  const restarts = sec("restart").filter((e) => e.key.startsWith("restart:") && e.key !== "restart:none");
  if (downtime.length) push(4, { id: "downtime", badge: "ATTENTION", severity: "warn", title: `Downtime: ${names(downtime)}`, detail: downtime.map((e) => `${e.title}: ${e.line}`).join("; "), jiras: jirasOf(downtime), ref: ref("restart", downtime[0].key) });
  else if (restarts.length) push(5, { id: "restart", badge: "INFO", severity: "info", title: `Restart ${names(restarts)}`, detail: `${plural(restarts.length, "service")} to restart`, jiras: jirasOf(restarts), ref: ref("restart", restarts[0].key) });
  // 6 DB changes
  const db = sec("database").filter((e) => e.badge === "REQUIRED" || e.needsAttention);
  if (db.length || sqlCount) push(6, { id: "db", badge: "REQUIRED", severity: "warn", title: `${plural(db.length, "DB action")} to run`, detail: names(db), jiras: jirasOf(db), ref: db[0] ? ref("database", db[0].key) : undefined });
  // 7 not done rows
  if (r.headline.notDone > 0) {
    const nd = r.sections.flatMap((s) => s.entries.filter((e) => e.badge === "NOT DONE").map((e) => ({ s: s.id, e })));
    push(7, { id: "not-done", badge: "NOT DONE", severity: "warn", title: `${plural(r.headline.notDone, "release-page row")} not done`, detail: names(nd.map((x) => x.e)), jiras: jirasOf(nd.map((x) => x.e)), ref: nd[0] ? ref(nd[0].s, nd[0].e.key) : undefined });
  }
  // 8 unknowns by owner
  if (cl.unknownsByOwner.length) {
    const total = cl.unknownsByOwner.reduce((n, g) => n + g.items.length + (g.more ?? 0), 0);
    const jiras = [...new Set(cl.unknownsByOwner.flatMap((g) => g.items.flatMap((i) => i.sources.map((s) => s.jira))))].sort(cmpJiraKey);
    push(8, { id: "unknowns", badge: "UNKNOWN", severity: "warn", title: `${plural(total, "open question")} for the owners`, detail: cl.unknownsByOwner.map((g) => `${g.owner || "owner not named"} ${g.items.length + (g.more ?? 0)}`).join(", "), jiras });
  }
  // 9 PRs that are not part of the movement
  const notReleased = sec("branches").filter((e) => e.key === "stillopen" || e.key === "reverted" || e.key === "stackonly");
  if (notReleased.length) push(9, { id: "not-released", badge: "ATTENTION", severity: "warn", title: "PRs named but NOT released", detail: notReleased.map((e) => `${e.title}: ${e.line}`).join("; "), jiras: jirasOf(notReleased), ref: ref("branches", notReleased[0].key) });
  // 10 stale heads
  const stale = cl.warnings.filter((w) => w.code === "head_moved");
  if (stale.length) push(10, { id: "stale", badge: "ATTENTION", severity: "warn", title: `${plural(stale.length, "PR head")} moved after review`, detail: stale.map((w) => w.message.split(":")[0]).slice(0, 6).join(", "), jiras: [...new Set(stale.flatMap((w) => w.sources.map((s) => s.jira)))].sort(cmpJiraKey) });
  // 11 bundle SDK
  const sdk = sec("deploy").find((e) => e.key === "sdk");
  if (sdk && sdk.badge === "REQUIRED") push(11, { id: "sdk", badge: "REQUIRED", severity: "warn", title: "Bundle SDK build REQUIRED", detail: `${sdk.details?.find((d) => d.text === "Required")?.jiras.length ?? 1} of ${sdk.jiras.length} Jiras need a new SDK build`, jiras: sdk.details?.find((d) => d.text === "Required")?.jiras ?? sdk.jiras, ref: ref("deploy", "sdk") });
  // 12 real conflicts
  const conflicts = cl.conflicts.filter((c) => c.severity !== "info" && c.kind !== "order_cycle");
  if (conflicts.length) push(12, { id: "conflicts", badge: "ATTENTION", severity: "warn", title: `${plural(conflicts.length, "conflict")} between records`, detail: conflicts.slice(0, 3).map((c) => c.title).join("; "), jiras: [...new Set(conflicts.flatMap((c) => c.variants.flatMap((v) => v.sources.map((s) => s.jira))))].sort(cmpJiraKey) });

  return out
    .sort((a, b) => SEV_RANK[b.g.severity] - SEV_RANK[a.g.severity] || a.prio - b.prio)
    .slice(0, MAX_GLANCE)
    .map((x) => x.g);
}
