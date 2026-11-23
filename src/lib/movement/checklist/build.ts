/**
 * Merge the newest deployment record of every PR of every ticked Jira into ONE checklist.
 *
 * Pure: no DB, no network, no clock. The result depends only on the CONTENT of the input, not on
 * the order of the Jiras or records (both are processed in a canonical order), so
 * `hashChecklist` is stable. Everything that cannot be structured is kept as (cut) raw text with
 * its source; conflicts are surfaced (items carry `conflict`, the flat list feeds the banner),
 * never merged away.
 *
 * Bounds: every accumulator is a Map keyed by a normalised key (no pairwise dedupe), text and
 * source lists are capped, at most MAX_ITEMS_PER_SECTION items per section (flagged items are
 * kept first, the rest collapse into one "N more" item) and raw free text has a global budget.
 */
import type { CanonicalSection, Cover, ParsedRecord, PrRef, RowState } from "../record";
import { normalizeRepo, pickNewestPerPr, prKey } from "../record";
import type { MovementEnvironment } from "../values";
import { itemHash } from "./canon";
import { hashChecklist } from "./diff";
import { mergeOrder, type OrderRecord } from "./order";
import {
  branchesCompatible,
  canonicalService,
  EXTRA_FLUTTER,
  cap,
  isPattern,
  normBranch,
  normalizeOwner,
  normalizeSqlPath,
  repoService,
  resolveRepo,
  sig,
  splitConfigKeys,
  stepSig,
  capWhole,
  textKey,
  tidy,
  valueSig,
  valuesCompatible,
  type ServiceName,
  type ValueSig,
} from "./normalize";
import {
  MAX_CONFLICTS,
  MAX_ITEMS_PER_SECTION,
  MAX_RAW_CHARS,
  MAX_SOURCES_PER_ITEM,
  MAX_TEXT_CHARS,
  MAX_CHECKLIST_BYTES,
  MAX_UNKNOWNS_PER_OWNER,
  MAX_VARIANTS,
  MAX_VARIANT_SOURCES,
  MAX_WARNINGS,
  RAW_OVER_BUDGET_CHARS,
  RAW_TEXT_BUDGET,
  SECTIONS,
  type Checklist,
  type ChecklistInput,
  type ChecklistItem,
  type ChecklistJiraInput,
  type ChecklistSection,
  type ChecklistWarning,
  type Conflict,
  type ConflictKind,
  type ConflictVariant,
  type ConfigInfo,
  type ItemSeverity,
  type ItemSource,
  type SectionId,
  type SeverityCounts,
  type SignoffSummary,
  type UnknownsGroup,
} from "./types";

// ---------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------

class SrcSet {
  private m = new Map<string, ItemSource>();
  add(s: ItemSource | null) {
    if (!s) return;
    const k = `${s.jira}|${s.pr}|${s.section ?? ""}`;
    if (!this.m.has(k)) this.m.set(k, s);
  }
  get size() {
    return this.m.size;
  }
  /** Distinct Jira keys, in Jira order. */
  jiras(): string[] {
    return [...new Set([...this.m.values()].map((x) => x.jira))].sort(cmpJiraKey);
  }
  list(limit: number): ItemSource[] {
    const out: ItemSource[] = [];
    for (const s of this.m.values()) {
      if (out.length >= limit) break;
      out.push(s);
    }
    return out;
  }
}

function finalSources(set: SrcSet, limit: number): { sources: ItemSource[]; moreSources?: number } {
  const sources = set.list(limit);
  return set.size > limit ? { sources, moreSources: set.size - limit } : { sources };
}

/** Size limits of one build pass. Level 0 is the full checklist; higher levels condense it. */
interface Limits {
  text: number;
  rawCap: number;
  rawBudget: number;
  overBudgetCap: number;
  sources: number;
  items: number;
  unknownsPerOwner: number;
}
const LEVELS: Limits[] = [
  { text: MAX_TEXT_CHARS, rawCap: MAX_RAW_CHARS, rawBudget: RAW_TEXT_BUDGET, overBudgetCap: RAW_OVER_BUDGET_CHARS, sources: MAX_SOURCES_PER_ITEM, items: MAX_ITEMS_PER_SECTION, unknownsPerOwner: MAX_UNKNOWNS_PER_OWNER },
  { text: 300, rawCap: 700, rawBudget: 30_000, overBudgetCap: 140, sources: 8, items: MAX_ITEMS_PER_SECTION, unknownsPerOwner: 100 },
  { text: 200, rawCap: 300, rawBudget: 0, overBudgetCap: 120, sources: 3, items: 80, unknownsPerOwner: 40 },
  { text: 120, rawCap: 160, rawBudget: 0, overBudgetCap: 80, sources: 2, items: 40, unknownsPerOwner: 20 },
];

/** "CAV-1, CAV-2, +3 more": at most 8 Jira keys are spelled out. */
function fmtJiras(keys: string[]): string {
  return keys.length <= 8 ? keys.join(", ") : `${keys.slice(0, 8).join(", ")}, +${keys.length - 8} more`;
}

const SEV_RANK: Record<ItemSeverity, number> = { info: 0, warn: 1, blocker: 2 };
const maxSev = (a: ItemSeverity | undefined, b: ItemSeverity | undefined): ItemSeverity | undefined =>
  !a ? b : !b ? a : SEV_RANK[a] >= SEV_RANK[b] ? a : b;

export function cmpJiraKey(a: string, b: string): number {
  const ma = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(a);
  const mb = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(b);
  if (ma && mb) {
    if (ma[1] !== mb[1]) return ma[1] < mb[1] ? -1 : 1;
    return Number(ma[2]) - Number(mb[2]);
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

const asObj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

interface AccItem {
  key: string;
  text: string;
  srcs: SrcSet;
  severity?: ItemSeverity;
  label?: string;
  raw?: true;
  needsAttention?: true;
  env?: ChecklistItem["env"];
  config?: ConfigInfo;
  seq?: number;
  group?: string;
  conflict?: ChecklistItem["conflict"];
  rank?: number;
  jiras?: string[];
  chips?: string[];
  answers?: ChecklistItem["answers"];
  /** Severity of the conflict currently shown on the item. */
  itemConflictSev?: ItemSeverity;
}

interface AddOpts {
  severity?: ItemSeverity;
  label?: string;
  /** Text may be up to MAX_RAW_CHARS (then the item is marked raw). */
  long?: boolean;
  /** A long text may grow to this many characters at full detail (release-page rows merged over many Jiras keep every instruction). */
  growRaw?: number;
  /** The text is a record section's own text. */
  raw?: boolean;
  group?: string;
  seq?: number;
  /** Raw text cap for this item (default: the level's raw cap). */
  maxRaw?: number;
}

interface RecCtx {
  jira: string;
  rec: ParsedRecord;
  pr: string;
  repo: string | null;
  secs: Map<CanonicalSection, ParsedRecord["sections"][number]>;
  srcCache: Map<number, ItemSource>;
  /** A `union` record: it covers several PRs and has no `repo#pr` of its own. */
  union?: { covers: string[]; key: string; label: string };
}

function srcOf(c: RecCtx, section?: number): ItemSource {
  const k = section ?? 0;
  let s = c.srcCache.get(k);
  if (!s) {
    s = section === undefined ? { jira: c.jira, pr: c.pr } : { jira: c.jira, pr: c.pr, section };
    if (c.union) {
      s.n = c.union.covers.length;
      s.covers = c.union.covers.slice(0, 6);
    }
    c.srcCache.set(k, s);
  }
  return s;
}

function rawClean(s: string): string {
  return s
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The text of an unknown found in a release-page row: "<label> <answer>" when the answer is one sentence, else "<label>: <the sentence that holds the
 * unknown (and names the owner)>", so three owners of one long row each get their own clause instead of the same cut-off row.
 */
export function unknownClause(label: string, answer: string, owner: string | null): string {
  const full = tidy(`${label} ${answer}`, 4000);
  const sentences = tidy(answer, 4000).split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 2) return full;
  const who = owner ? sig(owner) : "";
  const hit = sentences.find((x) => /unknown/i.test(x) && (!who || sig(x).includes(who)));
  return hit ? `${tidy(label, 200)}: ${hit}` : full;
}

// ---------------------------------------------------------------------------------------------
// accumulator
// ---------------------------------------------------------------------------------------------

class Acc {
  constructor(
    private readonly lim: Limits,
    private readonly env: MovementEnvironment,
  ) {}
  readonly sections = new Map<SectionId, Map<string, AccItem>>(SECTIONS.map((s) => [s.id, new Map()]));
  rawUsed = 0;
  readonly conflicts: Conflict[] = [];

  add(section: SectionId, key: string, text: string, src: ItemSource | null, opts: AddOpts = {}): AccItem {
    const map = this.sections.get(section) as Map<string, AccItem>;
    let it = map.get(key);
    if (!it) {
      let body = opts.raw ? rawClean(text) : tidy(text);
      let raw = opts.raw === true;
      if (opts.long && !raw && body.length > this.lim.text) raw = true;
      if (raw) {
        const top = opts.growRaw && this.lim.rawCap === MAX_RAW_CHARS ? opts.growRaw : Math.min(this.lim.rawCap, opts.maxRaw ?? this.lim.rawCap);
        const room = this.rawUsed + Math.min(Buffer.byteLength(body), top) > this.lim.rawBudget ? Math.min(this.lim.overBudgetCap, top) : top;
        body = capWhole(body, room);
        this.rawUsed += Buffer.byteLength(body);
      } else {
        body = capWhole(body, this.lim.text);
      }
      it = { key, text: body, srcs: new SrcSet() };
      if (raw) it.raw = true;
      if (opts.group) it.group = opts.group;
      if (opts.seq !== undefined) it.seq = opts.seq;
      map.set(key, it);
    }
    it.srcs.add(src);
    // The label (Blocking / Should-fix / Nitpick) follows the severity that won.
    if (opts.label && (!it.label || (opts.severity && SEV_RANK[opts.severity] > (it.severity ? SEV_RANK[it.severity] : -1)))) it.label = opts.label;
    it.severity = maxSev(it.severity, opts.severity);
    return it;
  }

  conflict(section: SectionId, item: AccItem, kind: ConflictKind, title: string, variants: ConflictVariant[], severity: ItemSeverity = "warn", sub?: string) {
    const vs = variants.slice(0, MAX_VARIANTS).map((v) => ({ text: cap(v.text, 200), sources: v.sources.slice(0, MAX_VARIANT_SOURCES) }));
    // A per-environment value conflict in an environment other than the movement's target is information
    // only: it stays listed (and in the hash and the diff) but is not counted as a conflict to resolve.
    const offTarget = kind === "config_env_value" && sub !== undefined && sub !== this.env;
    if (offTarget) {
      severity = "info";
      title = `${title} (${sub}, not the target environment)`;
    }
    // One item can carry several conflicts (per-env values); the most severe stays on the item, all are listed.
    if (!item.conflict || SEV_RANK[severity] > SEV_RANK[item.itemConflictSev ?? "info"]) {
      item.conflict = { kind, variants: vs };
      item.itemConflictSev = severity;
    }
    if (!offTarget) item.severity = maxSev(item.severity, severity);
    const c: Conflict = { id: `${section}|${item.key}|${kind}${sub ? `|${sub}` : ""}`, kind, section, itemKey: item.key, title: cap(title, 200), severity, variants: vs };
    if (sub) c.sub = sub;
    this.conflicts.push(c);
  }
}

function addVariant(map: Map<string, { text: string; srcs: SrcSet }>, cmp: string, text: string, src: ItemSource) {
  let v = map.get(cmp);
  if (!v) {
    if (map.size >= 20) return;
    v = { text, srcs: new SrcSet() };
    map.set(cmp, v);
  }
  v.srcs.add(src);
}

function variantList(map: Map<string, { text: string; srcs: SrcSet }>): ConflictVariant[] {
  return [...map.values()].map((v) => ({ text: v.text, sources: v.srcs.list(MAX_VARIANT_SOURCES) }));
}

/** Known values of one setting: distinct by meaning, conflicting when ANY two are incompatible (see `valuesCompatible`). */
interface ValVar {
  text: string;
  sig: ValueSig;
  srcs: SrcSet;
}
type ValMap = Map<string, ValVar>;

function addVal(map: ValMap, raw: string, src: ItemSource) {
  const sg = valueSig(raw);
  if (sg.unknown) return; // unknown never hides or contradicts a value
  let e = map.get(sg.cmp);
  if (!e) {
    if (map.size >= 20) return;
    e = { text: cap(tidy(raw, 300), 120), sig: sg, srcs: new SrcSet() };
    map.set(sg.cmp, e);
  }
  e.srcs.add(src);
}

function valConflict(map: ValMap): boolean {
  const l = [...map.values()];
  for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) if (!valuesCompatible(l[i].sig, l[j].sig)) return true;
  return false;
}

const valVariants = (map: ValMap): ConflictVariant[] => [...map.values()].map((v) => ({ text: v.text, sources: v.srcs.list(MAX_VARIANT_SOURCES) }));

// --- leftover prose ------------------------------------------------------------------------------

const STOP = new Set(["the", "and", "also", "for", "this", "that", "with", "are", "was", "its", "per", "has", "have", "from", "into", "than", "then", "any", "all"]);

function splitSentences(line: string): string[] {
  return line.split(/(?<=[.!?])\s+(?=[A-Z0-9[("'])/).map((x) => x.trim()).filter(Boolean);
}

/**
 * The sentences of a section that no extracted fact represents (at least 30% of their content
 * words are not in any fact string). Table rows, and sentences that are only an
 * `unknown, owner to confirm` clause (they are in the unknowns block), are skipped.
 */
function leftoverProse(text: string, cover: string[], hasTable: boolean): string {
  const covered = new Set<string>();
  for (const c of cover) for (const w of sig(c, 4000).split(" ")) if (w) covered.add(w);
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (hasTable && (line.match(/ \| /g)?.length ?? 0) >= 2) continue;
    for (const sent of splitSentences(line)) {
      if (/owner to confirm/i.test(sent)) continue;
      const words = sig(sent).split(" ").filter((w) => w.length >= 3 && !STOP.has(w));
      if (!words.length) continue;
      let hit = 0;
      for (const w of words) if (covered.has(w)) hit++;
      if (hit / words.length >= 0.7) continue;
      out.push(sent);
    }
  }
  return out.join(" ");
}

/** Sections that have structured facts, with the strings those facts say (what the leftover check compares to). */
function leftoverPlan(rec: ParsedRecord): Array<[CanonicalSection, SectionId, string[], boolean]> {
  const f = rec.facts;
  const out: Array<[CanonicalSection, SectionId, string[], boolean]> = [];
  const pr = (r: PrRef) => `${r.repo}#${r.pr}`;
  if (f.summary || rec.status) out.push(["header", "header", [f.summary ?? "", rec.statusText ?? "", rec.status ?? "", f.headReviewed ?? "", f.headMovedTo ?? "", f.reviewUrl ?? "", "status head reviewed review moved since not yet reviewed"], false]);
  if (f.branch || f.baseBranch || f.prState || f.author) {
    out.push(["branches", "branches", [f.branch ?? "", f.baseBranch ?? "", f.prState ?? "", f.author ?? "", f.firstCommitBy ?? "", ...(f.approvers ?? []), f.mergedBy ?? "", ...(f.siblings ?? []).map(pr), ...(f.replaces ?? []).map((r) => `${r.repo ?? ""}#${r.pr} ${r.state ?? ""}`), "pr rule pass fail first commit approver none yet merged by not merged siblings open closed mergeable replaces"], false]);
  }
  if (f.deploy?.length || f.deployNone || f.deployNotes?.length) out.push(["deploy", "deploy", [...(f.deploy ?? []).flatMap((x) => [x.name, x.note ?? ""]), ...(f.deployNotes ?? []), "bundle sdk build required yes no unknown none"], false]);
  if (f.restart?.length || f.restartNone || f.restartNotes?.length) out.push(["restart", "restart", [...(f.restart ?? []).flatMap((x) => [x.name, x.note ?? ""]), ...(f.restartNotes ?? []), "downtime required yes no unknown restart reload none"], false]);
  if (f.database) out.push(["database", "database", [...f.database.items, ...f.database.sqlPaths, "no hand-run sql seen migration database change none"], false]);
  if (f.configs?.length || f.configsNone || f.configsSeeRefs?.length) {
    const rows = (f.configs ?? []).flatMap((r) => [r.key, r.store ?? "", r.default ?? "", r.demo ?? "", r.uat ?? "", r.prod ?? "", ...Object.values(r.extra ?? {})]);
    out.push(["configs", "configs", [...rows, ...(f.configsSeeRefs ?? []).map(pr), "none in this pr see"], true]);
  }
  if (f.roles?.length) out.push(["roles", "roles", [...f.roles.flatMap((r) => [r.who ?? "", r.what]), "negative"], false]);
  if (f.order) out.push(["order", "order", [...f.order.steps.map((x) => x.text), ...f.order.edges.flatMap((e) => [e.before, e.after]), ...f.order.gates, f.order.rollback ?? "", ...(f.order.jsonSteps ?? []), "gates rollback order"], false]);
  if (f.risks?.length) out.push(["risks", "risks", [...f.risks.map((r) => r.text), "should-fix blocking nitpick open carried"], false]);
  if (f.verification?.length) out.push(["verify", "verify", f.verification, false]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------------------------

interface ServiceAcc {
  svc: ServiceName;
  notes: Map<string, string>;
  srcs: SrcSet;
  fromBranch: Map<string, { text: string; srcs: SrcSet }>;
}

interface ConfigAcc {
  key: string;
  aliases: Map<string, string>;
  stores: Map<string, string>;
  srcs: SrcSet;
  defaults: ValMap;
  env: Record<"demo" | "uat" | "prod", ValMap>;
  /** Other table columns (who sets it, evidence): header -> distinct values. */
  extras: Map<string, { header: string; values: Map<string, string> }>;
  /** Every row came from the free-text lines of release-page row 11 ("Configs to add in prod"): only the prod state is stated. */
  textOnly: boolean;
}

interface ProdAcc {
  repo: string;
  values: Map<string, { text: string; srcs: SrcSet }>;
  unknown: SrcSet;
  known: boolean;
  srcs: SrcSet;
}

/**
 * Build the merged checklist. When the full form would exceed MAX_CHECKLIST_BYTES serialised, it
 * is condensed (shorter raw text and source lists, fewer items per section, config detail kept for
 * the target environment) and says so in a warning; nothing is dropped silently. The condensed
 * form is derived from the full one (not rebuilt), so the cost stays at one pass.
 */
export function buildChecklist(input: ChecklistInput, opts: { startLevel?: number } = {}): Checklist {
  const full = buildAt(input);
  let level = Math.min(Math.max(opts.startLevel ?? 0, 0), LEVELS.length - 1);
  let cl = level === 0 ? full : condense(full, level);
  while (level < LEVELS.length - 1 && Buffer.byteLength(JSON.stringify(cl)) > MAX_CHECKLIST_BYTES) cl = condense(full, ++level);
  cl.hash = hashChecklist(cl);
  return cl;
}

function configText(it: ChecklistItem): string {
  const c = it.config as NonNullable<ChecklistItem["config"]>;
  const e = it.env as NonNullable<ChecklistItem["env"]>;
  const parts = [c.aliases?.length ? `${c.key} (also: ${c.aliases.join(", ")})` : c.key];
  if (c.store) parts.push(`store: ${c.store}`);
  if (c.default !== undefined) parts.push(`default: ${c.default}`);
  parts.push(`${e.target}: ${e.targetValue ?? "unknown"}`);
  return parts.join(" | ");
}

/** A copy of `full` cut down to the limits of `level` (> 0). Items keep their keys; ids and hashes are recomputed. */
function condense(full: Checklist, level: number): Checklist {
  const lim = LEVELS[level];
  const cl = structuredClone(full);
  let rawUsed = 0;
  const capped: string[] = [];
  cl.sections = cl.sections.map((sec) => {
    let items = sec.items;
    let prior = 0;
    const last = items[items.length - 1];
    if (last && last.key === `more:${sec.id}`) {
      prior = last.count ?? 0;
      items = items.slice(0, -1);
    }
    items = items.map((it) => {
      if (level >= 2 && sec.id === "configs" && it.config && it.env) {
        // the target environment's value, store and default stay; the other environments and extras go first
        it.text = cap(configText(it), lim.text);
      } else if (it.raw) {
        const room = rawUsed + Math.min(Buffer.byteLength(it.text), lim.rawCap) > lim.rawBudget ? Math.min(lim.overBudgetCap, lim.rawCap) : lim.rawCap;
        it.text = cap(it.text, room);
        rawUsed += Buffer.byteLength(it.text);
      } else it.text = cap(it.text, lim.text);
      if (it.answers) it.answers = it.answers.map((x) => ({ ...x, text: capWhole(x.text, lim.rawCap), jiras: x.jiras.slice(0, lim.sources) }));
      if (it.sources.length > lim.sources) {
        it.moreSources = (it.moreSources ?? 0) + it.sources.length - lim.sources;
        it.sources = it.sources.slice(0, lim.sources);
      }
      return it;
    });
    const out = collapse(sec.id, items, lim.items, prior);
    const more = out.length && out[out.length - 1].key === `more:${sec.id}` ? (out[out.length - 1].count ?? 0) : 0;
    if (more > prior) capped.push(`Section ${sec.number} (${sec.title}): ${more} item${more === 1 ? "" : "s"} not shown (limit ${lim.items} per section)`);
    for (const it of out) {
      it.id = `${sec.id}|${it.key}`;
      it.ih = itemHash(it);
    }
    return { ...sec, items: out };
  });

  cl.unknownsByOwner = cl.unknownsByOwner.map((g) => {
    const items = g.items.slice(0, lim.unknownsPerOwner).map((u) => {
      if (u.sources.length > lim.sources) {
        u.moreSources = (u.moreSources ?? 0) + u.sources.length - lim.sources;
        u.sources = u.sources.slice(0, lim.sources);
      }
      return u;
    });
    const more = (g.more ?? 0) + (g.items.length - items.length);
    const o: UnknownsGroup = { owner: g.owner, items };
    if (more) o.more = more;
    return o;
  });

  // warnings: the condensed notice ranks first and can never be cut
  const prior = cl.warnings.find((w) => w.code === "warnings_truncated")?.count ?? 0;
  const list: ChecklistWarning[] = cl.warnings.filter((w) => w.code !== "warnings_truncated");
  list.push({ code: "checklist_condensed", message: "The checklist was condensed to stay within its size limit: long texts are cut and source lists shortened. Open the Jira records for the full text.", sources: [] });
  for (const m of capped) list.push({ code: "section_capped", message: m, sources: [] });
  list.sort((a, b) => warnRank(a.code) - warnRank(b.code) || (a.code < b.code ? -1 : a.code > b.code ? 1 : a.message < b.message ? -1 : a.message > b.message ? 1 : 0));
  let dropped = prior;
  let kept = list;
  if (list.length + (dropped ? 1 : 0) > MAX_WARNINGS) {
    dropped += list.length - (MAX_WARNINGS - 1);
    kept = list.slice(0, MAX_WARNINGS - 1);
  }
  if (dropped) kept.push({ code: "warnings_truncated", message: `+${dropped} more warnings not listed`, sources: [], count: dropped });
  for (const w of kept) if (w.sources.length > lim.sources) w.sources = w.sources.slice(0, lim.sources);
  cl.warnings = kept;

  tally(cl);
  return cl;
}

/** Recompute the item counters of a checklist after its sections changed. */
function tally(cl: Checklist) {
  let attention = 0;
  let items = 0;
  const sev: SeverityCounts = { blocker: 0, warn: 0, info: 0 };
  for (const s of cl.sections) {
    items += s.items.length;
    for (const it of s.items) {
      if (it.needsAttention) attention++;
      sev[it.severity ?? "info"]++;
    }
  }
  cl.stats.items = items;
  cl.stats.needsAttention = attention;
  cl.stats.bySeverity.items = sev;
  cl.summary = cl.summary.replace(/, \d+ need attention,/, `, ${attention} need attention,`);
}

function buildAt(input: ChecklistInput): Checklist {
  const lim = LEVELS[0];
  const env = input.environment;
  const acc = new Acc(lim, env);

  const included = input.jiras.filter((j) => j.included).sort((a, b) => cmpJiraKey(a.key, b.key));
  const heldIn = input.jiras.filter((j) => !j.included).sort((a, b) => cmpJiraKey(a.key, b.key));

  // --- contexts in canonical order, and the set of repo names that exist -----------------------
  const known = new Set<string>();
  const ctxs: RecCtx[] = [];
  const pendingWarns: Array<[string, string]> = [];
  for (const j of included) {
    const { recs, ignoredUnions } = effectiveRecords(j);
    if (ignoredUnions > 0) {
      pendingWarns.push(["older_review_comment_ignored", `${j.key}: ${ignoredUnions} older review comment${ignoredUnions === 1 ? " was" : "s were"} ignored (only the newest one feeds the checklist)`]);
    }
    for (const { rec, pr } of recs) {
      const repo = rec.marker.repo ? normalizeRepo(rec.marker.repo) : null;
      if (repo) known.add(repo);
      const secs = new Map<CanonicalSection, ParsedRecord["sections"][number]>();
      for (const s of rec.sections) if (s.canonical && !secs.has(s.canonical)) secs.set(s.canonical, s);
      const ctx: RecCtx = { jira: j.key, rec, pr, repo, secs, srcCache: new Map() };
      if (isUnion(rec)) {
        const covers = coverKeys(rec);
        ctx.union = { covers, key: covers.join(","), label: rec.marker.target ? cap(tidy(rec.marker.target, 100), 100) : `union of ${covers.length} PR${covers.length === 1 ? "" : "s"}` };
      }
      ctxs.push(ctx);
    }
  }
  const bump = (r: PrRef | undefined) => {
    if (r) known.add(normalizeRepo(r.repo));
  };
  for (const c of ctxs) {
    const f = c.rec.facts;
    f.siblings?.forEach(bump);
    f.appRelease?.refs.forEach(bump);
    f.configsSeeRefs?.forEach(bump);
    f.order?.steps.forEach((s) => s.refs.forEach(bump));
    f.covers?.forEach(bump);
  }
  for (const b of input.branches) known.add(normalizeRepo(b.repo));

  // accumulators needing a second pass
  const deploySvc = new Map<string, ServiceAcc>();
  const restartSvc = new Map<string, ServiceAcc>();
  const downtime = new Map<string, { name: string; yes: SrcSet; no: SrcSet }>();
  const sdk = { yes: new SrcSet(), no: new SrcSet() };
  const cfgs = new Map<string, ConfigAcc>();
  const prods = new Map<string, ProdAcc>();
  const apps = new Map<string, { required: boolean; srcs: SrcSet }>();
  const noApp = new SrcSet();
  const noSql = new SrcSet();
  const noDeploy = new SrcSet();
  const noRestart = new SrcSet();
  const orderRecs: OrderRecord[] = [];
  const unknowns = new Map<string, { owner: string; text: string; srcs: SrcSet }>();
  const warnings = new Map<string, { code: string; message: string; srcs: SrcSet }>();
  const prSet = new Set<string>();
  const headers = new Map<string, { parts: Map<string, { jiras: Set<string>; text: string; rank: number }>; srcs: SrcSet }>();

  // All warnings are collected (bounded); they are ranked by importance and cut at the end, so a flood
  // of parser warnings can never push a checklist-level one out.
  const warn = (code: string, message: string, src: ItemSource | null) => {
    const k = `${code}|${message}`;
    let w = warnings.get(k);
    if (!w) {
      if (warnings.size >= 5000) return;
      w = { code, message: cap(message, 240), srcs: new SrcSet() };
      warnings.set(k, w);
    }
    w.srcs.add(src);
  };

  for (const [code, message] of pendingWarns) warn(code, message, null);

  const svcAdd = (map: Map<string, ServiceAcc>, name: string, note: string | undefined, c: RecCtx, section: number, fromBranch?: string) => {
    const svc = canonicalService(name);
    let a = map.get(svc.key);
    if (!a) {
      a = { svc, notes: new Map(), srcs: new SrcSet(), fromBranch: new Map() };
      map.set(svc.key, a);
    }
    a.srcs.add(srcOf(c, section));
    // "#267" only names a PR: the sources already say which.
    const n = note ? tidy(note, 300).replace(/^#\d+[,;]?\s*/, "") : "";
    if (n && !/^this pr$/i.test(n) && a.notes.size < 8) {
      const k = sig(n);
      if (k && !a.notes.has(k)) a.notes.set(k, n);
    }
    if (fromBranch) {
      const nb = normBranch(fromBranch);
      if (nb) addVariant(a.fromBranch, nb.toLowerCase(), nb, srcOf(c, section));
    }
    return svc;
  };

  const rawSection = (c: RecCtx, canon: CanonicalSection, section: SectionId) => {
    const s = c.secs.get(canon);
    if (!s || !s.text.trim()) return;
    acc.add(section, textKey(`raw:${section}`, s.text), s.text, srcOf(c, s.number), { raw: true });
  };

  // --- free-form (dialect) records: release-page rows and labelled blocks ----------------------
  // One answer per (Jira, state): under the one-comment-per-Jira model each Jira answers the rows for itself.
  type RowAns = { jira: string; state: RowState; texts: Map<string, string>; srcs: SrcSet };
  const rowAcc = new Map<string, { id: string; n: number; label: string; section: SectionId; answers: Map<string, RowAns>; chips: Map<string, string> }>();

  const unionHeader = (c: RecCtx) => {
    const u = c.union as NonNullable<RecCtx["union"]>;
    const f = c.rec.facts;
    const blocks = f.labelled ?? [];
    const lab = (name: string) => blocks.find((b) => sig(b.label) === name)?.text;
    const what = lab("what") ?? f.summary;
    acc.add("header", `rec:union:${u.key}`, `${u.label}${what ? `: ${cap(tidy(what, 1000), 600)}` : ""}`, srcOf(c), { long: true });
    const status = lab("status") ?? c.rec.statusText ?? c.rec.status;
    if (status) {
      // HELD / PARTIAL / READY as written on the STATUS line decide the weight; HELD also needs attention.
      const w = f.statusWord;
      let sev: ItemSeverity | undefined;
      if (w === "HELD" || w === "PARTIAL") sev = "warn";
      else if (w === "READY") sev = "info";
      else sev = c.rec.status === "BLOCKED" ? "blocker" : c.rec.status === "PARTIAL" ? "warn" : undefined;
      const it = acc.add("header", `status:${u.key}`, `Review status: ${tidy(status, 300)}`, srcOf(c), { long: true, severity: sev });
      if (w === "HELD") it.needsAttention = true;
    }
    const declared = c.rec.marker.declaredPrs;
    if (declared !== undefined && declared !== u.covers.length) warn("covers_count_mismatch", `${c.jira}: The comment says ${declared} PRs but lists ${u.covers.length}`, srcOf(c));
  };

  const coverItems = (c: RecCtx) => {
    const f = c.rec.facts;
    const covers = f.covers ?? [];
    for (const cv of covers) {
      const parts = [`${resolveRepo(cv.repo, known)}#${cv.pr}`];
      if (cv.branch) parts.push(cv.branch);
      if (cv.sha) parts.push(cv.sha);
      if (cv.note) parts.push(cv.note);
      if (cv.state) parts.push(`[${cv.state}]`);
      const key = `${resolveRepo(cv.repo, known)}#${cv.pr}`;
      const noApproval = /no formal approval/i.test(cv.approval ?? "");
      // "no formal approval" is part of the PR's own line (with the warning on it): not a second "No formal approval: repo#n" item
      acc.add("branches", `cover:${key}`, `${parts.join(" ")}${noApproval ? " - no formal approval" : ""}`, srcOf(c), { long: true, ...(noApproval ? { severity: "warn" as const } : {}) });
      if (!noApproval && cv.approval) acc.add("branches", textKey("merged", cv.approval), `Merged PRs: ${tidy(cv.approval, 300)}`, srcOf(c), { long: true });
    }
    // PRs the ticket names that are NOT part of this movement: never counted, always shown
    const group = (list: Cover[] | undefined, key: string, title: string, attention: boolean) => {
      if (!list?.length) return;
      const names = list.map((cv) => `${resolveRepo(cv.repo, known)}#${cv.pr}${cv.note ? ` ${cv.note}` : ""}`);
      const it = acc.add("branches", `${key}:${list.map((cv) => `${resolveRepo(cv.repo, known)}#${cv.pr}`).sort().join(",")}`, `${title}: ${names.join("; ")}`, srcOf(c), { long: true, severity: "warn" });
      if (attention) it.needsAttention = true;
    };
    group(f.stillOpen, "stillopen", "Still open (not released)", true);
    group(f.reverted, "reverted", "Reverted, do not deploy as features", false);
    group(f.stackOnly, "stackonly", "Merged into stack branches only, nothing is released", false);
    // the lines of the MERGED PRs block that are not a PR line ("all approved and merged by ...")
    const block = (f.labelled ?? []).find((b) => sig(b.label) === "merged prs");
    for (const line of block?.lines ?? []) {
      if (/[A-Za-z0-9_.-]+#\d+/.test(line)) continue;
      const t = tidy(line.replace(/^\(|\)$/g, ""), 300);
      if (t) acc.add("branches", textKey("merged", t), `Merged PRs: ${t}`, srcOf(c), { long: true });
    }
  };

  const bulletLines = (lines: string[]): string[] => {
    const out: string[] = [];
    for (const l of lines) {
      const m = /^\s*(?:\d+[.)]|[-*\u2022])\s+(.*)$/.exec(l);
      if (m) out.push(m[1].trim());
      else if (out.length && /^\s/.test(l)) out[out.length - 1] += ` ${l.trim()}`;
      else if (l.trim()) out.push(l.trim());
    }
    return out;
  };

  /** Sigs of the LIKELY TO BE MISSED points and OPEN lines: facts.risks repeats them, they are shown elsewhere. */
  const dialectCovered = (c: RecCtx): Set<string> => {
    const out = new Set<string>();
    for (const b of c.rec.facts.labelled ?? []) {
      const n = sig(b.label);
      if (n.startsWith("likely to be missed") || n === "open") for (const l of bulletLines(b.lines)) out.add(sig(l));
    }
    for (const l of c.rec.facts.likelyMissed ?? []) out.add(sig(l.text));
    return out;
  };

  const dialectLabels = (c: RecCtx) => {
    const f = c.rec.facts;
    const has = {
      order: !!f.order?.steps.length,
      undo: !!f.order?.rollback,
      verify: !!f.verification?.length,
      stillOpen: !!f.stillOpen?.length,
      reverted: !!f.reverted?.length,
      stack: !!f.stackOnly?.length,
      owners: !!f.testOwners?.length,
    };
    for (const b of f.labelled ?? []) {
      const n = sig(b.label);
      if (n === "status" || n === "what" || n.startsWith("merged prs")) continue; // header / branches (above)
      if (n.startsWith("likely to be missed")) {
        for (const p of bulletLines(b.lines)) acc.add("testing", textKey("missed", p), `Likely to be missed: ${p}`, srcOf(c), { long: true, label: "Note" });
      } else if (n === "open") {
        for (const p of bulletLines(b.lines)) acc.add("risks", textKey("open", p), `Open: ${p}`, srcOf(c), { long: true, label: "Note" });
      } else if (
        (n === "order" && has.order) ||
        (n === "undo" && has.undo) ||
        (n === "verify" && has.verify) ||
        (n === "still open" && has.stillOpen) ||
        (n.startsWith("reverted") && has.reverted) ||
        (n.startsWith("merged into") && has.stack) ||
        (n === "test owners" && has.owners)
      ) {
        continue; // already in facts (order, rollback, verification, PR groups, test owners)
      } else if (b.text.trim()) {
        acc.add("risks", textKey("raw:label", `${b.label} ${b.text}`), `Other: ${b.label}: ${b.text}`, srcOf(c), { raw: true, maxRaw: 800 });
      }
    }
    // the likely-missed points and the test owners come as facts too (deduped with the label block by key)
    for (const l of f.likelyMissed ?? []) acc.add("testing", textKey("missed", l.text), `Likely to be missed: ${l.text}`, srcOf(c), { long: true, label: "Note" });
    for (const o of f.testOwners ?? []) {
      const unknown = valueSig(o.owner).unknown;
      const it = acc.add("testing", `owner:${sig(o.area ?? "")}:${sig(o.owner)}`, `Test owners: ${o.area ? `${o.area} - ` : ""}${o.owner}`, srcOf(c), { long: true, severity: unknown ? "warn" : undefined });
      if (unknown) it.needsAttention = true;
    }
  };

  const collectRows = (c: RecCtx) => {
    const f = c.rec.facts;
    for (const r of f.releaseRows ?? []) {
      const id = r.id ?? `n${r.n}:${sig(r.label)}`;
      let a = rowAcc.get(id);
      if (!a) {
        a = { id, n: r.n, label: cap(tidy(r.label, 120), 120), section: (r.id ? ROW_SECTION[r.id] : undefined) ?? "header", answers: new Map(), chips: new Map() };
        rowAcc.set(id, a);
      }
      const ak = `${c.jira}|${r.state}`;
      let v = a.answers.get(ak);
      if (!v) a.answers.set(ak, (v = { jira: c.jira, state: r.state, texts: new Map(), srcs: new SrcSet() }));
      // up to 1000 characters of the answer (the parser keeps at most that); a longer one ends with an explicit "…", never mid-word without a mark
      const text = cap(tidy(r.state === "other" ? r.answer : r.text, 4000), 1000);
      const tk = sig(text);
      if (text && v.texts.size < 4 && !v.texts.has(tk)) v.texts.set(tk, text);
      v.srcs.add(srcOf(c));
      if (r.id === "configs_prod") for (const k of f.configsText?.keys ?? []) if (a.chips.size < 12) a.chips.set(k, cap(k, 60));
    }
    // an unknown row the parser did not turn into an UnknownItem still has to reach the owner list
    const have = new Set(c.rec.unknowns.map((u) => u.rowId ?? `n${u.row}`));
    for (const r of f.releaseRows ?? []) {
      if (r.state !== "unknown" || have.has(r.id ?? `n${r.n}`)) continue;
      const owner = normalizeOwner(/^\(?([^)]*)\)?/.exec(r.text)?.[1] ?? r.text);
      const text = cap(tidy(`${r.label} ${r.answer}`, 4000), 1000);
      const k = `${owner}|${sig(text).slice(0, 160)}`;
      if (!unknowns.has(k)) unknowns.set(k, { owner, text, srcs: new SrcSet() });
      unknowns.get(k)?.srcs.add(srcOf(c));
    }
  };

  // --- per record -------------------------------------------------------------------------------
  for (const c of ctxs) {
    const { rec } = c;
    const f = rec.facts;
    if (c.union) for (const k of c.union.covers) prSet.add(k);
    else prSet.add(c.pr);

    // 1 header (one item per PR; a PR shared by Jiras keeps every distinct status text, worst first)
    if (c.union) unionHeader(c);
    else {
      const parts: string[] = [rec.statusText ?? rec.status ?? "no status line"];
      if (f.summary) parts.push("- " + cap(tidy(f.summary, 300), 160));
      let rank = rec.status === "BLOCKED" ? 2 : rec.status === "PARTIAL" ? 1 : 0;
      if (f.headMovedTo) {
        parts.push(`(head reviewed ${f.headReviewed ?? "?"}, has since moved to ${f.headMovedTo}${f.headMovedUnreviewed ? ", not reviewed" : ""})`);
        rank = Math.max(rank, 1);
        warn("head_moved", `${c.pr}: the PR head moved after the record's review`, srcOf(c, 1));
      }
      let h = headers.get(c.pr);
      if (!h) headers.set(c.pr, (h = { parts: new Map(), srcs: new SrcSet() }));
      h.srcs.add(srcOf(c, 1));
      const text = parts.join(" ");
      const e = h.parts.get(text);
      if (e) e.jiras.add(c.jira);
      else h.parts.set(text, { jiras: new Set([c.jira]), text, rank });
    }

    // 2 branches (a union record lists the PRs it covers; its MERGED PRs block adds notes)
    if (c.union) coverItems(c);
    {
      const hasFacts = f.branch || f.baseBranch || f.prState || f.author;
      if (hasFacts) {
        const p: string[] = [`${c.pr}: ${f.branch ?? "?"} -> ${f.baseBranch ?? "?"}`];
        if (f.prState) p.push(f.prState);
        if (f.author) p.push(`author ${f.author}`);
        if (f.approvers) p.push(f.approvers.length ? `approved by ${f.approvers.join(", ")}` : "no approver yet");
        if (f.mergedBy !== undefined) p.push(f.mergedBy ? `merged by ${f.mergedBy}` : "not merged");
        if (f.siblings?.length) p.push(`siblings ${f.siblings.map((s) => `${resolveRepo(s.repo, known)}#${s.pr}`).join(", ")}`);
        if (f.replaces?.length) p.push(`replaces ${f.replaces.map((r) => `${r.repo ? r.repo + "#" : "#"}${r.pr}${r.state ? ` (${r.state})` : ""}`).join(", ")}`);
        const bad = f.rule31 === "fail" || f.jiraIdInBranch === false;
        if (bad) p.push("branch name has no Jira id (Rule 31)");
        acc.add("branches", `pr:${c.pr}`, p.join("; "), srcOf(c, 2), { severity: bad ? "warn" : undefined });
      } else rawSection(c, "branches", "branches");
    }

    // 3 prod branch
    {
      if (f.prodBranch || f.prodBranches?.length) {
        const repo = c.repo ?? "(unknown repo)";
        let p = prods.get(repo);
        if (!p) {
          p = { repo, values: new Map(), unknown: new SrcSet(), known: false, srcs: new SrcSet() };
          prods.set(repo, p);
        }
        p.srcs.add(srcOf(c, 3));
        const list = f.prodBranches?.length ? f.prodBranches : f.prodBranch?.branch ? [f.prodBranch.branch] : [];
        for (const b of list) {
          const v = normBranch(b);
          if (!v) continue;
          addVariant(p.values, v.toLowerCase(), v, srcOf(c, 3));
          if (!(f.prodBranch?.unknown && isPattern(v))) p.known = true;
        }
        if (f.prodBranch?.unknown || !list.length) p.unknown.add(srcOf(c, 3));
      }
      rawSection(c, "prodBranch", "prodBranch");
    }

    // 4 deploy
    {
      const jd = Array.isArray(rec.json?.deploy) ? (rec.json?.deploy as unknown[]) : [];
      const fromBranches = new Map<string, string>();
      for (const e of jd) {
        const o = asObj(e);
        if (o && typeof o.service === "string" && typeof o.fromBranch === "string" && o.fromBranch.trim() && !valueSig(o.fromBranch).unknown) {
          fromBranches.set(canonicalService(o.service).key, o.fromBranch);
        }
      }
      const rowIds = new Set((f.releaseRows ?? []).map((r) => r.id));
      // The release-page row 2 / 12 is the single place for the services of a free-form record.
      for (const s of rowIds.has("services_deploy") ? [] : (f.deploy ?? [])) {
        const svc = svcAdd(deploySvc, s.name, s.note, c, 4, fromBranches.get(canonicalService(s.name).key));
        fromBranches.delete(svc.key);
      }
      for (const [key, br] of fromBranches) {
        const name = jd.map(asObj).find((o) => o && typeof o.service === "string" && canonicalService(o.service as string).key === key)?.service as string;
        svcAdd(deploySvc, name, undefined, c, 4, br);
      }
      if (f.deployNone) noDeploy.add(srcOf(c, 4));
      // the notes of row 2 are part of the row: shown once, by the row
      for (const n of rowIds.has("services_deploy") ? [] : (f.deployNotes ?? [])) acc.add("deploy", textKey("deploynote", n), n, srcOf(c, 4), { long: true });
      if (!f.deploy?.length && !f.deployNone && !f.deployNotes?.length) rawSection(c, "deploy", "deploy");
      // the SDK answer of a release-page row is that row's answer (one entry), not a second "Bundle SDK build" line
      if (!rowIds.has("bundle_sdk")) {
        if (f.bundleSdkBuild === "yes") sdk.yes.add(srcOf(c, 4));
        else if (f.bundleSdkBuild === "no") sdk.no.add(srcOf(c, 4));
      }
    }

    // 5 restart (+ downtime)
    {
      if (!(f.releaseRows ?? []).some((r) => r.id === "services_restart")) for (const s of f.restart ?? []) svcAdd(restartSvc, s.name, s.note, c, 5);
      if (f.restartNone) noRestart.add(srcOf(c, 5));
      for (const n of (f.releaseRows ?? []).some((r) => r.id === "services_restart") ? [] : (f.restartNotes ?? [])) acc.add("restart", textKey("restartnote", n), n, srcOf(c, 5), { long: true });
      if (!f.restart?.length && !f.restartNone && !f.restartNotes?.length) rawSection(c, "restart", "restart");
      if (f.downtime === "yes" || f.downtime === "no") {
        const targets: ServiceName[] = f.restart?.length
          ? f.restart.map((s) => canonicalService(s.name))
          : [c.repo ? repoService(c.repo) : null].filter((x): x is ServiceName => !!x);
        for (const t of targets) {
          let d = downtime.get(t.key);
          if (!d) {
            d = { name: t.name, yes: new SrcSet(), no: new SrcSet() };
            downtime.set(t.key, d);
          }
          (f.downtime === "yes" ? d.yes : d.no).add(srcOf(c, 5));
        }
      }
    }

    // 6 app release
    {
      const a = (f.releaseRows ?? []).some((r) => r.id === "app_release") ? undefined : f.appRelease; // a release-page row is the one place of this answer
      if (a) {
        const target = a.refs.length ? `${resolveRepo(a.refs[0].repo, known)}#${a.refs[0].pr}` : a.applicable === true ? c.pr : null;
        if (target) {
          let t = apps.get(target);
          if (!t) {
            t = { required: false, srcs: new SrcSet() };
            apps.set(target, t);
          }
          // Required only when the record of the app build itself says so.
          if (a.applicable === true && target === c.pr) t.required = true;
          t.srcs.add(srcOf(c, a.section));
        } else if (a.applicable === false) noApp.add(srcOf(c, a.section));
      }
      rawSection(c, "appRelease", "appRelease");
    }

    // 7 database
    {
      const d = f.database;
      if (d) {
        for (const it of d.items) {
          acc.add("database", textKey("db", it), it, srcOf(c, d.section), { long: true, severity: d.hasAction ? "warn" : undefined });
        }
        for (const p of d.sqlPaths) {
          const np = normalizeSqlPath(p);
          if (np) acc.add("database", `sql:${np}`, `SQL to run: ${np}`, srcOf(c, d.section), { severity: "warn" });
        }
        if (d.noSql && !d.hasAction && !d.items.length && !d.sqlPaths.length) noSql.add(srcOf(c, d.section));
      } else rawSection(c, "database", "database");
    }

    // 8 configs
    {
      let any = false;
      for (const row of f.configs ?? []) {
        for (const ck of splitConfigKeys(row.key)) {
          any = true;
          let a = cfgs.get(ck.key);
          if (!a) {
            a = { key: ck.key, aliases: new Map(), stores: new Map(), srcs: new SrcSet(), defaults: new Map(), env: { demo: new Map(), uat: new Map(), prod: new Map() }, extras: new Map(), textOnly: true };
            cfgs.set(ck.key, a);
          }
          if (row.source !== "text") a.textOnly = false;
          const src = srcOf(c, 8);
          a.srcs.add(src);
          for (const al of ck.aliases) if (a.aliases.size < 5) a.aliases.set(al.toLowerCase(), al);
          for (const st of [row.store, ck.note]) {
            if (!st) continue;
            const k = sig(st);
            if (k && a.stores.size < 4 && !a.stores.has(k)) a.stores.set(k, cap(tidy(st, 200), 120));
          }
          if (row.default !== undefined) addVal(a.defaults, row.default, src);
          for (const e of ["demo", "uat", "prod"] as const) {
            const raw = row[e];
            if (raw !== undefined) addVal(a.env[e], raw, src);
          }
          for (const [h, v] of Object.entries(row.extra ?? {})) {
            const hk = sig(h);
            if (!hk || !v.trim() || a.extras.size >= 6) continue;
            let ex = a.extras.get(hk);
            if (!ex) a.extras.set(hk, (ex = { header: cap(tidy(h, 60), 60), values: new Map() }));
            const vk = sig(v);
            if (vk && ex.values.size < 4 && !ex.values.has(vk)) ex.values.set(vk, cap(tidy(v, 160), 160));
          }
        }
      }
      if (!any && !(f.releaseRows ?? []).some((r) => r.id === "configs_prod")) {
        if (f.configsNone || f.configsSeeRefs?.length) {
          const refs = (f.configsSeeRefs ?? []).map((r) => `${resolveRepo(r.repo, known)}#${r.pr}`).sort();
          acc.add("configs", `cfgnone:${refs.join(",")}`, `No configs in this PR${refs.length ? `; see ${refs.join(", ")}` : ""}`, srcOf(c, 8));
        } else rawSection(c, "configs", "configs");
      }
    }

    // 9 roles
    {
      // roles read from the "Different designations" row ARE that row: shown once, by the row
      const fromRow = (f.releaseRows ?? []).some((r) => r.id === "designations") && f.roles?.length === 1 && f.roles[0].who === null && !f.roles[0].negative;
      if (fromRow) {
        // nothing more to say than the row
      } else if (f.roles?.length) {
        for (const r of f.roles) {
          const text = r.negative ? `Negative case${r.who ? ` (${r.who})` : ""}: ${r.what}` : `${r.who ?? "Check"}: ${r.what}`;
          acc.add("roles", textKey("role", `${r.negative ? "neg " : ""}${r.who ?? ""} ${r.what}`), text, srcOf(c, 9), { long: true });
        }
      } else rawSection(c, "roles", "roles");
    }

    // 10 compat
    {
      if (f.backwardCompat?.undo) acc.add("compat", textKey("undo", f.backwardCompat.undo), `Undo: ${f.backwardCompat.undo}`, srcOf(c, f.backwardCompat.section), { long: true });
      rawSection(c, "compat", "compat");
    }

    // 11 order, gates, rollback
    {
      const o = f.order;
      if (o) {
        orderRecs.push({ jira: c.jira, pr: c.pr, steps: o.steps, edges: o.edges, structured: o.structured });
        for (const g of o.gates) acc.add("order", `gate:${c.jira}:${stepSig(g)}`, `Gate: ${g}`, srcOf(c, 11), { long: true, group: c.jira, severity: "warn" });
        if (o.rollback) acc.add("order", `rollback:${c.jira}:${stepSig(o.rollback)}`, `Rollback: ${o.rollback}`, srcOf(c, 11), { long: true, group: c.jira });
      }
      if (!o?.steps.length && !o?.gates.length && !o?.rollback) rawSection(c, "order", "order");
    }

    // 12 testing
    {
      const t = f.testing;
      if (t) {
        const p: string[] = [];
        if (t.testCount !== undefined) p.push(`${t.testCount} test cases`);
        if (t.noCi) p.push("no CI run");
        if (t.notRunByReviewer) p.push("not run by the reviewer");
        if (p.length) acc.add("testing", `test:${c.pr}`, `${c.pr}: ${p.join(", ")}`, srcOf(c, t.section));
      }
      rawSection(c, "testing", "testing");
    }

    // 13 risks
    {
      if (f.risks?.length) {
        const shown = dialectCovered(c);
        for (const r of f.risks) {
          if (shown.has(sig(r.text))) continue; // a LIKELY TO BE MISSED / OPEN line: shown in its own section
          const sev: ItemSeverity = r.severity === "Blocking" ? "blocker" : r.severity === "Should-fix" ? "warn" : "info";
          acc.add("risks", textKey("risk", r.text), r.text, srcOf(c, 13), { long: true, severity: sev, label: r.severity ?? undefined });
        }
      } else rawSection(c, "risks", "risks");
      for (const s of rec.sections) {
        if (s.canonical === null && s.text.trim()) {
          acc.add("risks", textKey("raw:other", `${s.title} ${s.text}`), `Other section "${tidy(s.title, 80)}": ${s.text}`, srcOf(c, s.number), { raw: true });
        }
      }
    }

    // 14 verify
    {
      if (f.verification?.length) {
        for (const v of f.verification) acc.add("verify", textKey("verify", v), v, srcOf(c, 14), { long: true });
      } else rawSection(c, "verify", "verify");
    }

    // Free-form (dialect) record: labelled blocks and the numbered release-page rows.
    dialectLabels(c);
    collectRows(c);

    // Prose that no extracted fact represents is kept too (one raw item per record and section).
    for (const [canon, section, cover, table] of leftoverPlan(rec)) {
      const sec = c.secs.get(canon);
      if (!sec) continue;
      const text = leftoverProse(sec.text, cover, table);
      if (text) acc.add(section, textKey(`raw:lo:${section}`, text), text, srcOf(c, sec.number), { raw: true, maxRaw: 800 });
    }

    // 1 (cont.) header raw when nothing structured came from it
    if (!f.summary && !rec.status) rawSection(c, "header", "header");

    // unknowns and parser warnings
    for (const u of rec.unknowns) {
      const owner = normalizeOwner(u.owner);
      // the parser keeps 200 characters of the row; the row itself has up to 1000: use the clause that holds the unknown, whole
      const row = u.rowId ? (f.releaseRows ?? []).find((r) => r.id === u.rowId) : undefined;
      const utext = row ? unknownClause(row.label, row.answer, u.owner) : u.text;
      const k = `${owner}|${sig(utext).slice(0, 160)}`;
      let e = unknowns.get(k);
      if (!e) {
        e = { owner, text: cap(tidy(utext, 4000), 1000), srcs: new SrcSet() };
        unknowns.set(k, e);
      }
      e.srcs.add(srcOf(c, u.section ?? undefined));
    }
    for (const w of rec.warnings.filter((x) => !(c.union && x.code === "covers_count_mismatch"))) warn(w.code.startsWith("record_") ? w.code : `record_${w.code}`, `${c.union ? c.union.label : c.pr}: ${w.message}`, srcOf(c));
    if (rec.truncated) warn("record_truncated", `${c.pr}: a safety limit cut the record while it was read`, srcOf(c));
  }

  // --- release-page rows of free-form records: one item per row id, Not required collapsed per section
  const notReq = new Map<SectionId, { labels: string[]; srcs: SrcSet }>();
  const phrase = (state: RowState, text: string): string =>
    state === "other" ? text : state === "unknown" ? (text ? (text.startsWith("(") ? `Unknown ${text}` : `Unknown (${text})`) : "Unknown") : `${ROW_WORD[state]}${text ? ` ${text}` : ""}`;
  const STATE_ORDER: RowState[] = ["not_done", "unknown", "done", "yes", "no", "other", "not_required"];
  const YES_FIRST: RowState[] = ["yes", "not_done", "unknown", "done", "no", "other", "not_required"];
  const DB_ROW_IDS = new Set(["previous_data", "db_queries", "db_index", "ui_indexdb"]);
  /** "No", "Not required" and "Done: none": nothing to do. */
  const isNone = (state: RowState, t: string) => state === "no" || state === "not_required" || (state === "done" && /^(none|nothing)\b/i.test(t.trim()));
  const dbRowsAcc = [...rowAcc.values()].filter((a) => DB_ROW_IDS.has(a.id));
  const dbAllNo = dbRowsAcc.length > 0 && dbRowsAcc.every((a) => [...a.answers.values()].every((v) => isNone(v.state, [...v.texts.values()].join(" "))));
  const dbNoneSrcs = new SrcSet();
  for (const a of [...rowAcc.values()].sort((x, y) => x.n - y.n || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
    // a Jira's own unknown never hides or contradicts its own answer; two different answers of ONE Jira conflict
    const byJira = new Map<string, RowAns[]>();
    for (const v of a.answers.values()) {
      const l = byJira.get(v.jira);
      if (l) l.push(v);
      else byJira.set(v.jira, [v]);
    }
    const eff: RowAns[] = [];
    const inJira: Array<{ jira: string; use: RowAns[] }> = [];
    for (const [jira, list] of [...byJira.entries()].sort((x, y) => cmpJiraKey(x[0], y[0]))) {
      const known = list.filter((v) => v.state !== "unknown");
      const use = known.length ? known : list;
      if (use.length > 1) inJira.push({ jira, use });
      eff.push(...use);
    }
    const textOf = (v: RowAns) => [...v.texts.values()].join(" / ");
    const say = (v: RowAns) => phrase(v.state, textOf(v));
    const srcsOf = (list: RowAns[]) => list.flatMap((v) => v.srcs.list(1000));

    // database topics: the four rows are the ONE place; when every Jira says "no" they are one "No database change" line, and the UI index db row only shows when someone says more than "no"
    if (DB_ROW_IDS.has(a.id) && (dbAllNo || (a.id === "ui_indexdb" && eff.every((v) => isNone(v.state, textOf(v)))))) {
      for (const s of srcsOf(eff)) dbNoneSrcs.add(s);
      continue;
    }
    if (eff.every((v) => v.state === "not_required")) {
      const t = textOf(eff[0]);
      let g = notReq.get(a.section);
      if (!g) notReq.set(a.section, (g = { labels: [], srcs: new SrcSet() }));
      g.labels.push(t ? `${a.label} (${t})` : a.label);
      for (const s of srcsOf(eff)) g.srcs.add(s);
      continue;
    }

    // group the answers by (state, the words the Jira wrote): the same answer in several Jiras is one group, a different instruction is its own
    type Group = { state: RowState; text: string; jiras: Map<string, string> };
    const groups = new Map<string, Group>();
    for (const v of eff) {
      const t = textOf(v);
      const key = `${v.state}|${sig(t)}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { state: v.state, text: t, jiras: new Map() }));
      g.jiras.set(v.jira, t);
    }
    const order = YES_FIRST_IDS.has(a.id) ? YES_FIRST : STATE_ORDER;
    const glist = [...groups.values()].sort((x, y) => order.indexOf(x.state) - order.indexOf(y.state));
    const keysOf = (g: Group) => fmtJiras([...g.jiras.keys()]);
    let text: string;
    if (byJira.size === 1 && inJira.length) text = `${a.label}: answers differ (${inJira[0].use.map(say).join(" || ")})`;
    else if (groups.size === 1) text = `${a.label}: ${say(eff[0])}`; // every Jira says the same
    else {
      // "Yes: CAV-1 — what it wrote; CAV-2 — what it wrote · Done: CAV-3 — ... · No: CAV-4, CAV-5": each instruction once, with its Jiras
      const states = [...new Set(glist.map((g) => g.state))];
      const piece = (st: RowState): string => {
        const gs = glist.filter((g) => g.state === st);
        if (st === "other") return gs.map((g) => `${g.text} (${keysOf(g)})`).join("; ");
        // an open answer's few words read as "(who)"; an instruction reads as "— what it says"
        const say1 = (g: Group) => `${keysOf(g)}${g.text ? ((st === "not_done" || st === "unknown") && g.text.length <= 160 ? ` ${g.text.startsWith("(") ? g.text : `(${g.text})`}` : ` — ${g.text}`) : ""}`;
        return `${ROW_WORD[st]}: ${gs.map(say1).join("; ")}`;
      };
      const worst = glist.find((g) => g.state !== "other" && g.state !== "not_required");
      text = `${a.label}: ${worst ? `${ROW_WORD[worst.state]} — ` : ""}${states.map(piece).join(" · ")}`;
    }
    const openState = glist.some((g) => g.state === "not_done" || g.state === "unknown");
    // "Configs to add in prod" only matters as an open item on the PROD movement.
    const open = openState && (a.id !== "configs_prod" || env === "prod");
    const it = acc.add(a.section, `row:${a.id}`, text, null, { long: true, growRaw: 8000, severity: open ? "warn" : undefined });
    for (const s of srcsOf(eff)) it.srcs.add(s);
    if (eff.length > 1 && (groups.size > 1 || glist.some((g) => g.text))) it.answers = glist.slice(0, 24).map((g) => ({ state: g.state, text: capWhole(g.text, 1500), jiras: [...g.jiras.keys()].slice(0, 40) }));
    if (open) it.needsAttention = true;
    if (a.chips.size) it.chips = [...a.chips.values()];
    // only ONE Jira's own records disagreeing is a conflict; different Jiras simply answer for themselves
    for (const { jira, use } of inJira) {
      acc.conflict(a.section, it, "row_state", `Release-page answer differs: ${a.label}${byJira.size > 1 ? ` (${jira})` : ""}`, use.map((v) => ({ text: say(v), sources: v.srcs.list(MAX_VARIANT_SOURCES) })), "warn", jira);
    }
  }
  if (dbNoneSrcs.size && dbAllNo) {
    const it = acc.add("database", "db:none", "No database change", null);
    for (const s of dbNoneSrcs.list(1000)) it.srcs.add(s);
  }
  for (const [section, g] of notReq) {
    const it = acc.add(section, `notreq:${section}`, `Not required: ${g.labels.join(", ")}`, null, { long: true });
    for (const s of g.srcs.list(1000)) it.srcs.add(s);
  }

  // --- second pass: services -------------------------------------------------------------------
  const flushServices = (section: "deploy" | "restart", map: Map<string, ServiceAcc>) => {
    const list = [...map.values()].sort((a, b) => a.svc.rank - b.svc.rank || (a.svc.name < b.svc.name ? -1 : a.svc.name > b.svc.name ? 1 : 0));
    for (const a of list) {
      const notes = [...a.notes.values()];
      const br = [...a.fromBranch.values()];
      // a different deploy-from branch per Jira is not a conflict: each Jira names its own
      const from = br.length > 1 ? br.map((b) => `${b.text} (${fmtJiras(b.srcs.jiras())})`).join(" / ") : br.map((b) => b.text).join("");
      const text = `${a.svc.name}${notes.length ? ` - ${notes.join("; ")}` : ""}${br.length ? ` (from ${from})` : ""}`;
      const it = acc.add(section, `${section === "deploy" ? "svc" : "restart"}:${a.svc.key}`, text, null, { long: true });
      for (const s of a.srcs.list(1000)) it.srcs.add(s);
      it.rank = a.svc.rank;
      if (!a.svc.cc) it.label = "extra line (not on the release page tick list)";
    }
  };
  // Services must come before the other items of the section: build them into the maps, then
  // reorder at the end (sections are sorted in `finish`), so the order of the add calls is irrelevant.
  flushServices("deploy", deploySvc);
  flushServices("restart", restartSvc);

  if (noDeploy.size) {
    const it = acc.add("deploy", "deploy:none", "No service to deploy (declared by these PRs)", null);
    for (const s of noDeploy.list(1000)) it.srcs.add(s);
  }
  if (noRestart.size) {
    const it = acc.add("restart", "restart:none", "No restart or reload needed (declared by these PRs)", null);
    for (const s of noRestart.list(1000)) it.srcs.add(s);
  }

  // SDK build: each Jira answers for itself, so the answer is "required if any Jira says so", naming the Jiras
  if (sdk.yes.size || sdk.no.size) {
    const parts: string[] = [];
    if (sdk.yes.size) parts.push(`required (${fmtJiras(sdk.yes.jiras())})`);
    if (sdk.no.size) parts.push(`not required (${fmtJiras(sdk.no.jiras())})`);
    const it = acc.add("deploy", "sdk", `Bundle SDK build: ${parts.length > 1 ? parts.join("; ") : sdk.yes.size ? "required" : "not required"}`, null);
    for (const s of [...sdk.yes.list(1000), ...sdk.no.list(1000)]) it.srcs.add(s);
  }

  // downtime per service: "Yes (CAV-1, CAV-2); No (CAV-3)"
  for (const d of [...downtime.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const both = d.yes.size > 0 && d.no.size > 0;
    const detail = both ? `Yes (${fmtJiras(d.yes.jiras())}); No (${fmtJiras(d.no.jiras())})` : d.yes.size ? "Yes" : "No";
    const it = acc.add("restart", `downtime:${d.name.toLowerCase()}`, `Downtime required for ${d.name}: ${detail}`, null, {
      severity: d.yes.size ? "warn" : undefined,
    });
    for (const s of [...d.yes.list(1000), ...d.no.list(1000)]) it.srcs.add(s);
  }

  // app release
  for (const [target, a] of [...apps.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    const it = acc.add("appRelease", `app:${target}`, a.required ? `App release required: ${target}` : `App release: ${target} (named by another PR, not confirmed in its own record)`, null, {
      severity: a.required ? undefined : "warn",
    });
    for (const s of a.srcs.list(1000)) it.srcs.add(s);
  }
  if (noApp.size) {
    const it = acc.add("appRelease", "app:none", "No app release needed (declared by these PRs)", null);
    for (const s of noApp.list(1000)) it.srcs.add(s);
  }
  if (noSql.size) {
    const it = acc.add("database", "db:nosql", "No hand-run SQL or database action declared by these PRs", null);
    for (const s of noSql.list(1000)) it.srcs.add(s);
  }

  // header: one item per PR, every distinct status text (worst first), severity from the worst
  for (const [pr, h] of headers) {
    const parts = [...h.parts.values()].sort((x, y) => y.rank - x.rank || (x.text < y.text ? -1 : x.text > y.text ? 1 : 0));
    const text = parts.length === 1 ? `${pr}: ${parts[0].text}` : `${pr}: ${parts.map((x) => `${[...x.jiras].sort(cmpJiraKey).join("/")}: ${x.text}`).join(" || ")}`;
    const worst = parts[0].rank;
    const it = acc.add("header", `rec:${pr}`, text, null, { long: true, severity: worst >= 2 ? "blocker" : worst === 1 ? "warn" : undefined });
    for (const src of h.srcs.list(1000)) it.srcs.add(src);
  }

  // prod branch (only the prod movement flags an unconfirmed prod branch; a store build has none)
  const isProd = env === "prod";
  const prodHints = new Map<string, string[]>();
  for (const p of [...prods.values()].sort((a, b) => (a.repo < b.repo ? -1 : 1))) {
    const vals = [...p.values.values()].map((v) => v.text);
    prodHints.set(p.repo, vals);
    const storeBuild = repoService(p.repo)?.name === EXTRA_FLUTTER;
    const attention = isProd && !p.known && !storeBuild;
    let text: string;
    if (storeBuild && !vals.length) text = `${p.repo}: built as a store release (no prod branch)`;
    else text = `${p.repo}: ${vals.length ? vals.join(" / ") : "not stated"}${attention ? " (not confirmed; owner to confirm)" : ""}`;
    const it = acc.add("prodBranch", `prod:${p.repo}`, text, null, { severity: attention ? "warn" : undefined });
    for (const s of p.srcs.list(1000)) it.srcs.add(s);
    if (attention) it.needsAttention = true;
    const vs = [...p.values.values()].slice(0, 20);
    let incompatible = false;
    for (let i = 0; i < vs.length && !incompatible; i++) for (let j = i + 1; j < vs.length; j++) if (!branchesCompatible(vs[i].text, vs[j].text)) incompatible = true;
    if (incompatible) acc.conflict("prodBranch", it, "prod_branch", `${p.repo}: two different prod branches`, variantList(p.values));
  }

  // the user's branch picks (two different picks for one repo are kept, shown and warned about)
  const picks = new Map<string, Set<string>>();
  for (const b of input.branches) {
    const repo = resolveRepo(b.repo, known);
    const br = normBranch(b.branch);
    if (!repo || !br) continue;
    let set = picks.get(repo);
    if (!set) picks.set(repo, (set = new Set()));
    if (set.size < 6) set.add(br);
  }
  const pickList: Array<[string, string]> = [];
  for (const [repo, set] of [...picks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const brs = [...set].sort();
    for (const br of brs) pickList.push([repo, br]);
    const it = acc.add("prodBranch", `pick:${repo}`, `Branch picked for ${repo}: ${brs.join(" / ")}${brs.length > 1 ? " (two different picks)" : ""}`, null, { severity: brs.length > 1 ? "warn" : undefined });
    if (brs.length > 1) warn("branch_pick_conflict", `${repo}: ${brs.length} different branches were picked (${brs.join(", ")})`, null);
    const hints = prodHints.get(repo) ?? [];
    const off = hints.length ? brs.filter((br) => !hints.some((h) => branchesCompatible(h, br))) : [];
    if (off.length) {
      const hp = prods.get(repo);
      acc.conflict("prodBranch", it, "branch_mismatch", `${repo}: the picked branch differs from the record's prod branch`, [
        { text: `picked: ${off.join(" / ")}`, sources: [] },
        { text: `record: ${hints.join(" / ")}`, sources: hp ? hp.srcs.list(MAX_VARIANT_SOURCES) : [] },
      ]);
    }
  }

  // configs (env-aware)
  for (const a of [...cfgs.values()].sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))) {
    const stores = [...a.stores.values()];
    const aliases = [...a.aliases.values()];
    const defaultText = a.defaults.size ? [...a.defaults.values()][0].text : undefined;
    const values = {} as Record<"demo" | "uat" | "prod", string | null>;
    for (const e of ["demo", "uat", "prod"] as const) values[e] = a.env[e].size ? [...a.env[e].values()][0].text : null;
    const targetValue = values[env];
    const keyLabel = aliases.length ? `${a.key} (also: ${aliases.join(", ")})` : a.key;
    const parts = [keyLabel];
    if (stores.length) parts.push(`store: ${stores.join(" / ")}`);
    if (defaultText !== undefined) parts.push(`default: ${defaultText}`);
    parts.push(`demo: ${values.demo ?? "unknown"}`, `uat: ${values.uat ?? "unknown"}`, `prod: ${values.prod ?? "unknown"}`);
    for (const ex of a.extras.values()) parts.push(`${ex.header}: ${[...ex.values.values()].join(" / ")}`);
    const it = acc.add("configs", `cfg:${a.key}`, parts.join(" | "), null, { long: true });
    for (const s of a.srcs.list(1000)) it.srcs.add(s);
    const config: ConfigInfo = { key: a.key };
    if (aliases.length) config.aliases = aliases;
    if (stores.length) config.store = stores.join(" / ");
    if (defaultText !== undefined) config.default = defaultText;
    it.config = config;
    it.env = { target: env, targetValue, values };
    // Unknown, "not set" or "Not Done" for the target environment needs attention. A row from the prod-only
    // lines of release-page row 11 says nothing about demo or UAT, so it is not flagged there.
    const openValue = targetValue === null || /^(not set|not done|unset)\b/i.test(targetValue);
    if (openValue && !(a.textOnly && env !== "prod")) {
      it.needsAttention = true;
      it.severity = maxSev(it.severity, "warn");
    }
    if (valConflict(a.defaults)) acc.conflict("configs", it, "config_default", `${a.key}: different defaults`, valVariants(a.defaults));
    for (const e of ["demo", "uat", "prod"] as const) {
      if (valConflict(a.env[e])) acc.conflict("configs", it, "config_env_value", `${a.key}: different ${e} values`, valVariants(a.env[e]).map((v) => ({ ...v, text: `${e}: ${v.text}` })), "warn", e);
    }
  }

  // deploy order
  {
    // order sources are made by mergeOrder: give a union source its PR count back
    const unionByJira = new Map<string, ItemSource>();
    for (const c of ctxs) if (c.union && !unionByJira.has(c.jira)) unionByJira.set(c.jira, { jira: c.jira, pr: "union", section: 11, n: c.union.covers.length, covers: c.union.covers.slice(0, 6) });
    const merged = mergeOrder(orderRecs, known, prSet);
    for (const s of merged.steps) {
      const it = acc.add("order", `step:${s.key}`, `${s.label}`, null, { seq: s.seq, severity: s.cycle ? "blocker" : undefined, long: true });
      for (const src of s.sources) it.srcs.add(src.pr === "union" ? (unionByJira.get(src.jira) ?? src) : src);
      it.jiras = s.jiras.sort(cmpJiraKey);
      if (s.cycle) it.label = "on or after a cycle";
    }
    for (const cyc of merged.cycles) {
      const first = acc.sections.get("order")?.get(`step:${cyc.keys[0]}`);
      if (!first) continue;
      acc.conflict("order", first, "order_cycle", `Deploy order cycle: ${cyc.labels.map((l) => cap(l, 60)).join(" -> ")}`, [{ text: cyc.labels.map((l) => cap(l, 80)).join(" -> "), sources: cyc.sources }], "blocker");
    }
    for (const u of merged.unlisted) {
      for (const src of u.sources.length ? u.sources : [null]) warn("order_ref_not_in_movement", `${u.pr} is named in the deploy order but has no record in this movement (a held Jira's PR, another repo, or not reviewed yet)`, src);
    }
    for (const l of merged.selfLoops) for (const src of l.sources) warn("order_self_loop", `a step is ordered before itself and was ignored: ${l.label}`, src);
    if (merged.truncated) warn("order_truncated", "the deploy-order graph was cut at its size limit", null);
  }

  // --- finish: sections, header scope, collapse, top-level lists --------------------------------
  const signoffs: SignoffSummary[] = included.map((j) => {
    const dev = j.signoffs?.dev ?? "missing";
    const tester = j.signoffs?.tester ?? "missing";
    return { jira: j.key, dev, tester, anyMissing: dev === "missing" || tester === "missing" };
  });
  const prsByJira = new Map<string, Set<string>>();
  for (const c of ctxs) {
    let s = prsByJira.get(c.jira);
    if (!s) prsByJira.set(c.jira, (s = new Set()));
    if (c.union) for (const k of c.union.covers) s.add(k);
    else s.add(c.pr);
  }
  const scopeJiras = included.map((j) => scopeOf(j, [...(prsByJira.get(j.key) ?? [])].sort()));
  const held = heldIn.map((j) => {
    const h: Checklist["held"][number] = { jira: j.key, readiness: j.readiness };
    if (j.summary) h.summary = cap(tidy(j.summary, 200), 200);
    if (j.override) h.override = { reason: cap(tidy(j.override.reason, 300), 300), by: j.override.by };
    return h;
  });

  const lists: Array<{ def: (typeof SECTIONS)[number]; items: ChecklistItem[] }> = SECTIONS.map((def) => {
    const items = [...(acc.sections.get(def.id) as Map<string, AccItem>).values()];
    return { def, items: sortItems(def.id, items).map((a) => toItem(a, lim)) };
  });

  // The scope line and the overrides are added BEFORE the cap, so the header can never exceed it.
  const scopeText = `Environment ${env.toUpperCase()}: ${included.length} Jira${included.length === 1 ? "" : "s"}, ${prSet.size} PR${prSet.size === 1 ? "" : "s"} in the union${held.length ? `; ${held.length} held back (${held.map((h) => `${h.jira} ${h.readiness}`).join(", ")})` : ""}`;
  const overrides = included
    .filter((j) => j.override)
    .map((j) => ({
      key: `override:${j.key}`,
      text: cap(`${j.key} included by admin override: ${tidy(j.override?.reason ?? "", 300)} (${j.override?.by ?? "?"})`, MAX_TEXT_CHARS),
      sources: [] as ItemSource[],
      severity: "warn" as const,
    }));
  lists[0].items.unshift(blank({ key: "scope", text: cap(scopeText, MAX_TEXT_CHARS), sources: [] }), ...overrides.map(blank));

  const sectionsOut: ChecklistSection[] = lists.map(({ def, items }) => {
    const out = collapse(def.id, items, lim.items);
    if (out.length > 0 && out[out.length - 1].key === `more:${def.id}`) {
      const n = out[out.length - 1].count ?? 0;
      warn("section_capped", `Section ${def.number} (${def.title}): ${n} item${n === 1 ? "" : "s"} not shown (limit ${lim.items} per section)`, null);
    }
    for (const it of out) {
      it.id = `${def.id}|${it.key}`;
      it.ih = itemHash(it);
    }
    return { id: def.id, number: def.number, title: def.title, items: out };
  });

  const unknownGroups = new Map<string, UnknownsGroup & { all: Array<{ text: string; srcs: SrcSet }> }>();
  for (const u of unknowns.values()) {
    let g = unknownGroups.get(u.owner);
    if (!g) {
      g = { owner: u.owner, items: [], all: [] };
      unknownGroups.set(u.owner, g);
    }
    g.all.push({ text: u.text, srcs: u.srcs });
  }
  const unknownsByOwner: UnknownsGroup[] = [...unknownGroups.values()]
    .sort((a, b) => (a.owner === "" ? 1 : b.owner === "" ? -1 : a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0))
    .map((g) => {
      const shown = g.all.slice(0, lim.unknownsPerOwner).map((x) => ({ text: x.text, ...finalSources(x.srcs, lim.sources) }));
      const out: UnknownsGroup = { owner: g.owner, items: shown };
      if (g.all.length > lim.unknownsPerOwner) out.more = g.all.length - lim.unknownsPerOwner;
      return out;
    });

  // conflicts: blockers first (an order cycle is always a blocker), then by section; cut at the cap with a warning
  const allConflicts = [...acc.conflicts].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || secNum(a.section) - secNum(b.section) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const conflicts = allConflicts.slice(0, MAX_CONFLICTS);
  if (allConflicts.length > MAX_CONFLICTS) warn("conflicts_truncated", `${allConflicts.length - MAX_CONFLICTS} more conflicts are not listed (${allConflicts.length} in total); every conflicted item still carries its own marker`, null);

  // checklist-level warnings
  for (const j of included) {
    if (!j.records.length) warn("no_records", `${j.key} is ticked but has no deployment record`, null);
    if (j.readiness === "blocked") warn("included_blocked", `${j.key} is ticked although it is blocked (no override)`, null);
    if (j.readiness === "override") warn("override", `${j.key} is included by an admin override${j.override ? `: ${cap(tidy(j.override.reason, 160), 160)} (${j.override.by})` : ""}`, null);
  }
  const ranked = [...warnings.values()].sort((a, b) => warnRank(a.code) - warnRank(b.code) || (a.code < b.code ? -1 : a.code > b.code ? 1 : a.message < b.message ? -1 : a.message > b.message ? 1 : 0));
  const toWarning = (w: (typeof ranked)[number]): ChecklistWarning => ({ code: w.code, message: w.message, sources: w.srcs.list(lim.sources) });
  const warningsOut: ChecklistWarning[] = ranked.length <= MAX_WARNINGS ? ranked.map(toWarning) : ranked.slice(0, MAX_WARNINGS - 1).map(toWarning);
  if (ranked.length > MAX_WARNINGS) {
    const rest = ranked.length - (MAX_WARNINGS - 1);
    warningsOut.push({ code: "warnings_truncated", message: `+${rest} more warnings not listed`, sources: [], count: rest });
  }

  let attention = 0;
  let itemCount = 0;
  const sevItems: SeverityCounts = { blocker: 0, warn: 0, info: 0 };
  for (const s of sectionsOut) {
    itemCount += s.items.length;
    for (const it of s.items) {
      if (it.needsAttention) attention++;
      sevItems[it.severity ?? "info"]++;
    }
  }
  const sevConf: SeverityCounts = { blocker: 0, warn: 0, info: 0 };
  for (const c of acc.conflicts) sevConf[c.severity]++;
  const countedConflicts = sevConf.blocker + sevConf.warn; // info conflicts (other environments) are listed, not counted
  let unknownCount = 0;
  for (const g of unknownsByOwner) unknownCount += g.items.length + (g.more ?? 0);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const summary = `${plural(prSet.size, "PR")}${ctxs.length !== prSet.size ? ` (${plural(ctxs.length, "review comment")})` : ""}, ${plural(countedConflicts, "conflict")}${sevConf.info ? ` (+${sevConf.info} in other environments)` : ""}, ${attention} need attention, ${plural(unknownCount, "unknown")}`;

  return {
    version: 1,
    hash: "",
    summary,
    environment: env,
    scope: {
      jiras: scopeJiras,
      branches: pickList.map(([repo, branch]) => ({ repo, branch })),
    },
    sections: sectionsOut,
    unknownsByOwner,
    conflicts,
    warnings: warningsOut,
    signoffs,
    held,
    stats: {
      jiras: input.jiras.length,
      included: included.length,
      held: held.length,
      records: ctxs.length,
      comments: ctxs.length,
      prs: prSet.size,
      items: itemCount,
      conflicts: countedConflicts,
      unknowns: unknownCount,
      needsAttention: attention,
      bySeverity: { items: sevItems, conflicts: sevConf },
    },
  };
}

const WARN_RANK: Record<string, number> = {
  checklist_condensed: 0,
  conflicts_truncated: 1,
  section_capped: 2,
  included_blocked: 3,
  no_records: 4,
  branch_pick_conflict: 5,
  override: 6,
  order_ref_not_in_movement: 7,
  order_truncated: 8,
  head_moved: 9,
};
/** Checklist-level warnings first, then order/head notes, then the record parser's own warnings. */
const warnRank = (code: string) => WARN_RANK[code] ?? (code.startsWith("record_") ? 30 : 20);

/** An item built outside the accumulator (scope line, overrides): id and ih are filled when the section is final. */
function blank(x: Pick<ChecklistItem, "key" | "text" | "sources"> & { severity?: ItemSeverity }): ChecklistItem {
  return { id: "", ih: "", ...x };
}

function scopeOf(j: ChecklistJiraInput, prs: string[]): Checklist["scope"]["jiras"][number] {
  const o: Checklist["scope"]["jiras"][number] = { jira: j.key, readiness: j.readiness, prs };
  if (j.summary) o.summary = cap(tidy(j.summary, 200), 200);
  if (j.override) o.override = { reason: cap(tidy(j.override.reason, 300), 300), by: j.override.by };
  return o;
}

const secNum = (id: SectionId) => SECTIONS.findIndex((s) => s.id === id);

export const isUnion = (rec: ParsedRecord) => rec.marker.scope === "union";

/**
 * The records of one Jira that feed the checklist, in canonical order: the newest per PR, and of several
 * union ("review comment") records only the newest. Shared by the checklist and the rollup.
 */
export function effectiveRecords(j: ChecklistJiraInput): { recs: Array<{ rec: ParsedRecord; pr: string; sort: string }>; ignoredUnions: number } {
  // Defensive: the caller already chose the newest record per PR; a second one for the same PR is dropped here.
  const picked = pickNewestPerPr(j.records);
  // One review comment per Jira is the norm: of several union records only the newest feeds the checklist.
  const unions = picked.filter(isUnion);
  let newest: ParsedRecord | undefined;
  if (unions.length > 1) newest = unions.reduce((a, b) => (newerRecord(b, a) ? b : a));
  const recs = picked
    .filter((r) => !isUnion(r) || r === newest || unions.length <= 1)
    .map((rec) => ({ rec, pr: recPr(rec), sort: recSortKey(rec) }))
    .sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : cmpId(a.rec.comment.id, b.rec.comment.id)));
  return { recs, ignoredUnions: unions.length > 1 ? unions.length - 1 : 0 };
}

/** `a` is newer than `b`: by header version, then updated / created time, then comment id. */
function newerRecord(a: ParsedRecord, b: ParsedRecord): boolean {
  const va = a.marker.version ?? 0;
  const vb = b.marker.version ?? 0;
  if (va !== vb) return va > vb;
  const ta = Date.parse(a.comment.updated ?? a.comment.created ?? "") || 0;
  const tb = Date.parse(b.comment.updated ?? b.comment.created ?? "") || 0;
  if (ta !== tb) return ta > tb;
  return cmpId(a.comment.id, b.comment.id) > 0;
}

/** `repo#n` of every PR a record covers (a union record's list, or a per-PR record's own PR), sorted. */
export function coverKeys(rec: ParsedRecord): string[] {
  const set = new Set<string>();
  for (const cv of rec.facts.covers ?? []) set.add(prKey(cv.repo, cv.pr));
  return [...set].sort();
}

/** The PR label of a record. A union record is `union`; a record with no PR is `(no PR)`: never a comment id (ids and hashes must not depend on them). */
export function recPr(rec: ParsedRecord): string {
  const m = rec.marker;
  if (isUnion(rec)) return "union";
  return m.repo && m.pr !== null ? prKey(m.repo, m.pr) : "(no PR)";
}

/** Canonical processing order: by PR, a union record by what it covers. */
function recSortKey(rec: ParsedRecord): string {
  return isUnion(rec) ? `union|${coverKeys(rec).join(",")}` : recPr(rec);
}

export const ROW_SECTION: Record<string, SectionId> = {
  meeting: "header",
  services_deploy: "deploy",
  bundle_sdk: "deploy",
  app_release: "appRelease",
  old_app_version: "appRelease",
  code_reviewed: "branches",
  bundle_reviewed: "branches",
  ui_reviewed: "branches",
  previous_data: "database",
  db_queries: "database",
  db_index: "database",
  ui_indexdb: "database",
  new_app_old_data: "compat",
  features_old_data: "compat",
  beta_compat: "compat",
  configs_prod: "configs",
  services_restart: "restart",
  performance: "testing",
  automation_run: "testing",
  automation_updated: "testing",
  scenarios: "testing",
  designations: "roles",
  cherry_pick: "prodBranch",
};

/** Rows where "any Jira says yes" is the answer for the movement. */
/** Rows where "yes" means something has to be done: it leads the answers and decides the badge. */
export const YES_FIRST_IDS = new Set(["bundle_sdk", "app_release", "previous_data", "db_queries", "db_index", "ui_indexdb"]);

export const ROW_WORD: Record<RowState, string> = { done: "Done", not_done: "Not done", not_required: "Not required", yes: "Yes", no: "No", unknown: "Unknown", other: "" };

function cmpId(a: string, b: string): number {
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) ? x - y : a < b ? -1 : a > b ? 1 : 0;
}

function toItem(a: AccItem, lim: Limits): ChecklistItem {
  const it: ChecklistItem = { id: "", ih: "", key: a.key, text: a.text, ...finalSources(a.srcs, lim.sources) };
  if (a.jiras) it.jiras = a.jiras;
  if (a.chips) it.chips = a.chips;
  if (a.answers) it.answers = a.answers;
  if (a.severity) it.severity = a.severity;
  if (a.label) it.label = a.label;
  if (a.conflict) it.conflict = a.conflict;
  if (a.raw) it.raw = true;
  if (a.needsAttention) it.needsAttention = true;
  if (a.env) it.env = a.env;
  if (a.config) it.config = a.config;
  if (a.seq !== undefined) it.seq = a.seq;
  if (a.group) it.group = a.group;
  return it;
}

/** Deterministic display order per section (all inputs are already in canonical order). */
function sortItems(section: SectionId, items: AccItem[]): AccItem[] {
  const idx = new Map(items.map((it, i) => [it, i]));
  const byIdx = (a: AccItem, b: AccItem) => (idx.get(a) as number) - (idx.get(b) as number);
  switch (section) {
    case "risks": {
      const rank = (it: AccItem) => (it.severity === "blocker" ? 0 : it.severity === "warn" ? 1 : 2) + (it.raw ? 3 : 0);
      return [...items].sort((a, b) => rank(a) - rank(b) || byIdx(a, b));
    }
    case "deploy":
    case "restart": {
      // services first (page order), then everything else in first-seen order
      const rank = (it: AccItem) => it.rank ?? 5000;
      return [...items].sort((a, b) => rank(a) - rank(b) || byIdx(a, b));
    }
    case "order": {
      const seq = (it: AccItem) => (it.seq !== undefined ? it.seq : it.key.startsWith("gate:") ? 1e9 : 2e9);
      return [...items].sort((a, b) => seq(a) - seq(b) || byIdx(a, b));
    }
    default:
      return items;
  }
}

/**
 * Cap a section: flagged items survive, the rest collapse into one "N more" item. `prior` is the
 * count of an earlier "N more" item (when a capped section is condensed further).
 */
function collapse(section: SectionId, items: ChecklistItem[], max: number, prior = 0): ChecklistItem[] {
  const moreItem = (n: number): ChecklistItem => ({ id: "", ih: "", key: `more:${section}`, text: `${n} more item${n === 1 ? "" : "s"} not shown (section limit ${max})`, sources: [], count: n });
  if (items.length + (prior ? 1 : 0) <= max) return prior ? [...items, moreItem(prior)] : items;
  const keep = max - 1;
  const flagged = (it: ChecklistItem) => !!(it.conflict || it.needsAttention || it.key === "scope" || it.key.startsWith("override:") || (it.severity && it.severity !== "info"));
  const chosen = new Set<number>();
  for (let i = 0; i < items.length && chosen.size < keep; i++) if (flagged(items[i])) chosen.add(i);
  for (let i = 0; i < items.length && chosen.size < keep; i++) chosen.add(i);
  const out: ChecklistItem[] = [];
  items.forEach((it, i) => {
    if (chosen.has(i)) out.push(it);
  });
  out.push(moreItem(items.length - out.length + prior));
  return out;
}
