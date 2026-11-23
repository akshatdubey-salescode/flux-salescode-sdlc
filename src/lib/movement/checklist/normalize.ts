/**
 * Normalisation of the facts the checklist de-duplicates on: service names (to the names of the
 * Confluence release page), config keys, values, SQL paths, step texts, owners, branch patterns.
 *
 * Every function is pure and bounded: inputs are cut to a few hundred chars before any regex, and
 * no regex has a nested unbounded quantifier.
 */
import { createHash } from "node:crypto";
import { normalizeRepo } from "../record";

const INVISIBLE_RE = /[\u200B-\u200F\u2060\uFEFF\u00AD]/g;
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Lone surrogates become U+FFFD (a lone surrogate makes Postgres jsonb reject the whole value). */
export function wellFormed(s: string): string {
  return s.replace(LONE_SURROGATE_RE, "\uFFFD");
}

/** Cut to `n` UTF-16 units without ever splitting a surrogate pair. */
export function sliceSafe(s: string, n: number): string {
  if (s.length <= n) return s;
  let end = n;
  const c = s.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--;
  return s.slice(0, end);
}

export function cap(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${sliceSafe(s, Math.max(0, n - 1)).trimEnd()}\u2026`;
}

/**
 * `cap` that keeps whole sentences: the sentences (split at ". ", "; ", "! ", "? ") that fit in `n` are kept and the rest is counted ("(+2 more)").
 * A single sentence longer than `n` stays whole up to 1.5 x `n`, then is cut at a word with "…" (the one bound that must hold).
 */
export function capWhole(s: string, n: number): string {
  if (s.length <= n) return s;
  const parts = s.split(/(?<=[.!?;])\s+/).filter(Boolean);
  const keep: string[] = [];
  let len = 0;
  for (const p of parts) {
    if (keep.length && len + p.length + 1 > n) break;
    keep.push(p);
    len += p.length + 1;
  }
  const more = parts.length - keep.length;
  const text = keep.join(" ");
  if (text.length > n * 1.5) {
    const cut = text.slice(0, Math.floor(n * 1.5));
    return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).trimEnd()}\u2026`;
  }
  return `${text}${more > 0 ? ` (+${more} more)` : ""}`;
}

/** Collapse whitespace runs; cut first so a huge string never reaches a regex. */
export function tidy(s: string, max = 4000): string {
  return wellFormed(sliceSafe(s, max)).replace(/\s+/g, " ").trim();
}

/** Evidence tags only: `[V]`, `[I]`, `[author]`, `[author's ...]`. Any other bracket is a real value (`[IN, VN]`). */
const TAG_RE = /\[(?:V|I|author(?:'s[^\]]{0,60})?)\]/gi;

export function stripTags(s: string): string {
  return s.replace(TAG_RE, " ");
}

/** Lower-case letters and digits (any script) only: the comparison form of a free text. */
export function sig(s: string, max = 600): string {
  return stripTags(wellFormed(sliceSafe(s, max)))
    .normalize("NFKC")
    .replace(INVISIBLE_RE, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}#]+/gu, " ")
    .trim();
}

/** A map key for a free text: the words, or words plus a hash when long (bounded key size). */
export function textKey(prefix: string, text: string): string {
  const full = sig(text, 4000);
  if (full.length <= 120) return `${prefix}:${full}`;
  return `${prefix}:${sliceSafe(full, 100)}~${createHash("sha1").update(full).digest("hex").slice(0, 10)}`;
}

// ---------------------------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------------------------

/** exact known repo, else a UNIQUE `-name` suffix match (`flutter` -> `channelkart-flutter`), else as written. */
export function resolveRepo(name: string, known: ReadonlySet<string>): string {
  const n = normalizeRepo(name);
  if (known.has(n)) return n;
  let hit: string | null = null;
  for (const k of known) {
    if (k.endsWith(`-${n}`)) {
      if (hit) return n; // ambiguous: never guess
      hit = k;
    }
  }
  return hit ?? n;
}

// ---------------------------------------------------------------------------------------------
// Services (names of the CC release page, plus extras)
// ---------------------------------------------------------------------------------------------

/** The page's tick list, in page order. */
export const CC_SERVICES = [
  "Channel Kart",
  "Channelkart Bundle",
  "KPI Dashboard - UI",
  "Stock",
  "Promo",
  "Claims",
  "Loadout",
  "Rewards",
  "ML",
  "KPI",
  "Notification",
  "Reports Jar",
  "Reports Service",
  "Slake Reporting",
] as const;

export const EXTRA_FLUTTER = "Flutter app (SFA)";
export const EXTRA_AUTH = "salescode-auth-service";

const ALIASES: Record<string, string[]> = {
  "Channel Kart": ["channelkart", "channel kart", "ck", "channelkart core", "channelkart backend", "channel kart core", "core"],
  "Channelkart Bundle": ["channelkart bundle", "bundle", "ck bundle", "bundle jar"],
  "KPI Dashboard - UI": [
    "kpi dashboard",
    "kpi dashboard ui",
    "kpi dashboard portal",
    "kpi ui",
    "portal",
    "portal build",
    "portal ui",
    "dashboard ui",
    "ui",
  ],
  Stock: ["stock", "stocks", "stockservice", "stock service"],
  Promo: ["promo", "promos", "promo service", "promos service", "promotions", "promotion service"],
  Claims: ["claims", "claim", "claim service", "claims service"],
  Loadout: ["loadout", "loadout service", "dms loadout", "salescode dms loadout"],
  Rewards: ["rewards", "reward", "rewards service", "reward service"],
  ML: ["ml", "ml service"],
  KPI: ["kpi", "kpis", "kpi service"],
  Notification: ["notification", "notifications", "notification service"],
  "Reports Jar": ["reports jar", "report jar", "slake custom reports", "custom reports"],
  "Reports Service": ["reports service", "report service", "reports"],
  "Slake Reporting": ["slake reporting", "slake reporting config", "slake", "slake config"],
  [EXTRA_FLUTTER]: [
    "flutter",
    "flutter app",
    "flutter app build",
    "channelkart flutter",
    "app build",
    "sfa",
    "sfa app",
    "mobile app",
    "app",
  ],
  [EXTRA_AUTH]: ["salescode auth service", "auth service", "auth", "salescode auth"],
};

const ALIAS_INDEX: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [canon, list] of Object.entries(ALIASES)) {
    m.set(words(canon), canon);
    for (const a of list) m.set(words(a), canon);
  }
  return m;
})();

const CC_RANK = new Map<string, number>(CC_SERVICES.map((n, i) => [n, i]));

function words(s: string): string {
  return (s.length > 200 ? s.slice(0, 200) : s)
    .toLowerCase()
    .replace(/\([^)]{0,100}\)/g, " ")
    .replace(/[_\-/.]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ServiceName {
  /** Display name (release-page name when known). */
  name: string;
  /** Lower-case key. */
  key: string;
  /** On the CC tick list. */
  cc: boolean;
  /** Sort rank: page order for CC names, 1000 for extras. */
  rank: number;
}

/** True when the name is one the release page (or the extras) knows: "bundle", "Slake", "UI", "app", "Flutter app (SFA)" ... */
export function isKnownService(raw: string): boolean {
  const w = words(raw);
  if (ALIAS_INDEX.has(w)) return true;
  const parts = w.split(" ");
  return parts.length > 1 && ["service", "build", "deploy", "only"].includes(parts[parts.length - 1]) && ALIAS_INDEX.has(parts.slice(0, -1).join(" "));
}

export function canonicalService(raw: string): ServiceName {
  const w = words(raw);
  let canon = ALIAS_INDEX.get(w);
  if (!canon) {
    // "Promo service", "Flutter app build": drop one trailing filler word.
    const parts = w.split(" ");
    const last = parts[parts.length - 1];
    if (parts.length > 1 && (last === "service" || last === "build" || last === "deploy" || last === "only")) {
      canon = ALIAS_INDEX.get(parts.slice(0, -1).join(" "));
    }
  }
  if (canon) {
    const rank = CC_RANK.get(canon);
    return { name: canon, key: canon.toLowerCase(), cc: rank !== undefined, rank: rank ?? 1000 };
  }
  const shown = cap(tidy(raw, 200), 80) || "(unnamed service)";
  return { name: shown, key: w || shown.toLowerCase(), cc: false, rank: 1000 };
}

/** The release-page service a repo builds ("channelkart-flutter" -> Flutter app (SFA)). */
export function repoService(repo: string): ServiceName | null {
  const n = normalizeRepo(repo);
  const canon = ALIAS_INDEX.get(words(n));
  if (!canon) return null;
  return canonicalService(canon);
}

// ---------------------------------------------------------------------------------------------
// Configs
// ---------------------------------------------------------------------------------------------

const KEY_TOKEN_RE = /^[A-Za-z][A-Za-z0-9_.\-[\]*]{0,150}$/;
const KEY_PREFIXES = new Set([
  "channelkart",
  "kpi-dashboard",
  "auth-service",
  "salescode-auth-service",
  "flutter",
  "channelkart-flutter",
  "stockservice",
  "channelkart-bundle",
]);
const KEY_WORDS = new Set(["property", "key", "config", "setting", "variable", "flag", "env", "switch"]);

function looksLikeKeyToken(t: string): boolean {
  return KEY_TOKEN_RE.test(t) && (/[._]/.test(t) || /^[A-Z0-9]{4,}$/.test(t) || /[a-z][A-Z]/.test(t));
}

export interface ConfigKey {
  key: string;
  aliases: string[];
  /** A trailing remark that is not an alias, e.g. "(per-LOB property)": goes to the store text. */
  note?: string;
}

function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && s.startsWith(sep, i)) {
      out.push(s.slice(from, i));
      from = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(s.slice(from));
  return out;
}

const trimDots = (t: string) => t.replace(/[.,;:]+$/g, "");

/**
 * One config-table key cell => one or more normalised keys.
 *  - backticks, zero-width characters and a trailing dot stripped, whitespace collapsed, case kept;
 *  - `a / b` becomes two keys when both halves are single key tokens;
 *  - `KEY (or property other.key)` => key KEY with an alias; `a.b.c (per-LOB property)` => key a.b.c + note;
 *  - `property a.b.c`, `a.b.c = true`, `channelkart a.b.c and mappings` => `a.b.c`
 *    (a sibling PR's row about the same setting dedupes with the owning PR's row).
 */
export function splitConfigKeys(raw: string): ConfigKey[] {
  const s = tidy(raw.replace(/`/g, "").replace(INVISIBLE_RE, ""), 400);
  if (!s) return [];
  const halves = splitTop(s, " / ").map((x) => x.trim()).filter(Boolean);
  const parts = halves.length > 1 && halves.every((h) => !/\s/.test(h.replace(/\([^)]*\)/g, ""))) ? halves : [s];
  const out: ConfigKey[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    let key = part;
    const aliases: string[] = [];
    let note: string | undefined;
    const alias = /^(\S{1,160}) \((?:or|aka|alias)\s+(?:property\s+|key\s+|variable\s+)?([^)]{1,160})\)$/i.exec(part);
    if (alias) {
      key = trimDots(alias[1]);
      aliases.push(trimDots(alias[2].trim()));
    } else {
      let w = part.split(" ");
      // `a.b.c = true` / `a.b.c: true`
      const eq = /^(\S{1,160}?)\s*(?:=|:)\s+\S.{0,100}$/.exec(part);
      if (eq && looksLikeKeyToken(trimDots(eq[1]))) w = [trimDots(eq[1])];
      if (w.length >= 2 && KEY_WORDS.has(w[0].toLowerCase()) && looksLikeKeyToken(trimDots(w[1])) && (w.length === 2 || w[2] === "and")) w = [trimDots(w[1])];
      if (w.length >= 2 && w.length <= 4 && KEY_PREFIXES.has(w[0].toLowerCase()) && looksLikeKeyToken(trimDots(w[1])) && (w.length === 2 || w[2] === "and")) w = [trimDots(w[1])];
      if (w.length === 1) {
        key = trimDots(w[0]);
      } else {
        const paren = /^(\S{1,160}) \(([^)]{1,100})\)$/.exec(part);
        if (paren && looksLikeKeyToken(trimDots(paren[1]))) {
          key = trimDots(paren[1]);
          note = paren[2].trim();
        }
      }
    }
    if (!seen.has(key)) {
      seen.add(key);
      out.push(note ? { key, aliases, note } : { key, aliases });
    }
  }
  return out;
}

// --- values -------------------------------------------------------------------------------------

const POS = new Set(["on", "true", "enabled", "enable", "yes", "set", "present", "exists", "exist", "rows"]);
const NEG = new Set(["off", "false", "disabled", "disable", "no", "unset", "absent", "none", "not"]);
const UNIT: Record<string, string> = {
  s: "s", sec: "s", secs: "s", second: "s", seconds: "s",
  ms: "ms", millisecond: "ms", milliseconds: "ms",
  min: "min", mins: "min", minute: "min", minutes: "min",
  h: "h", hr: "h", hrs: "h", hour: "h", hours: "h",
  d: "d", day: "d", days: "d",
};
/** A parenthetical that is an error code (`403`, `EG243`) is evidence, not scope. */
const EVIDENCE_CODE_RE = /^(?:[a-z]{1,3}\d{2,6}|\d{3})$/i;

export interface ValueSig {
  /** Nothing is known: empty, `unknown`, `unknown, owner to confirm: x`, `tbd`. */
  unknown: boolean;
  /** Identity of the normalised value (used as a map key); compatibility is `valuesCompatible`. */
  cmp: string;
  cls: "on" | "off" | "na" | "other";
  /** What follows the on/off word (`for ckcoe`, `except ckcoe`), or the whole value for `other`. */
  rest: string;
  /** Tenant / LOB names in parentheses, sorted: `(ckcoe, hfcoe)`. */
  scope: string[];
  num?: string;
  unit?: string;
}

const UNKNOWN_SIG: ValueSig = { unknown: true, cmp: "", cls: "other", rest: "", scope: [] };

/** A parenthetical is SCOPE when it only lists single tokens (tenants, LOBs, envs) and no error code. */
function parseScope(inner: string): string[] | null {
  const parts = inner.split(/\s*(?:,|;|\/|&|\band\b)\s*/i).map((x) => x.trim()).filter(Boolean);
  if (!parts.length || parts.length > 8) return null;
  for (const p of parts) if (!/^[\p{L}\p{M}\p{N}_.-]{1,40}$/u.test(p) || EVIDENCE_CODE_RE.test(p)) return null;
  return parts.map((p) => p.toLowerCase()).sort();
}

/**
 * Normalise a configuration value for comparison. The rule (documented here, tested both ways):
 *  - evidence tags (`[V] [I] [author]`) and evidence parentheticals (`(403 EG243)`, `(nothing changes)`,
 *    `(ticket said 300)`) are dropped; a parenthetical that only lists tenant names (`(ckcoedemo)`) is SCOPE;
 *  - on/true/enabled/yes/set are one class, off/false/disabled/no/unset another, `n/a` = `not applicable`;
 *  - whatever follows the class word stays significant (`on` != `on except ckcoe`, `set 120` != `set 300`);
 *  - a number may omit or abbreviate its unit (`120` = `120 seconds` = `120 s`); comma lists are order-free;
 *  - two scopes conflict only when both are present and differ (`on (ckcoe)` vs `on (ckcoedemo)`), a bare
 *    `on` is compatible with `on (ckcoedemo)` (it says nothing about where).
 */
export function valueSig(v: string | null | undefined): ValueSig {
  if (v == null) return UNKNOWN_SIG;
  let t = stripTags(wellFormed(sliceSafe(v, 300))).normalize("NFKC").replace(INVISIBLE_RE, "").toLowerCase();
  const scope: string[] = [];
  t = t.replace(/\(([^)]{0,200})\)/g, (_m, inner: string) => {
    const sc = parseScope(inner);
    if (sc) scope.push(...sc);
    return " ";
  });
  t = t
    .replace(/[^\p{L}\p{M}\p{N}.,\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,]+$/g, "")
    .trim();
  if (!t || /^(unknown|tbd)\b/.test(t) || t === "none yet") return UNKNOWN_SIG;
  scope.sort();
  if (t === "n a" || t === "na" || t === "not applicable") return { unknown: false, cmp: `na||${scope.join(",")}`, cls: "na", rest: "", scope };
  const words = t.split(" ");
  const cls: ValueSig["cls"] = POS.has(words[0]) ? "on" : NEG.has(words[0]) ? "off" : "other";
  let rest = cls === "other" ? t : words.slice(1).join(" ");
  if (rest.includes(",")) {
    rest = rest
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .sort()
      .join(",");
  }
  const out: ValueSig = { unknown: false, cmp: "", cls, rest, scope };
  if (cls === "other") {
    const m = /^(\d+(?:\.\d+)?)(?: ([a-z]+))?$/.exec(rest);
    if (m && (!m[2] || UNIT[m[2]])) {
      out.num = m[1];
      if (m[2]) out.unit = UNIT[m[2]];
    }
  }
  out.cmp = `${cls}|${out.num !== undefined ? `${out.num}${out.unit ? ` ${out.unit}` : ""}` : rest}|${scope.join(",")}`;
  return out;
}

/** Same meaning, or one is silent where the other is specific (unit, scope). Unknown is compatible with everything. */
export function valuesCompatible(a: ValueSig, b: ValueSig): boolean {
  if (a.unknown || b.unknown) return true;
  if (a.num !== undefined || b.num !== undefined) {
    if (a.num === undefined || b.num === undefined) return false;
    return a.num === b.num && (!a.unit || !b.unit || a.unit === b.unit);
  }
  if (a.cls !== b.cls || a.rest !== b.rest) return false;
  if (a.scope.length && b.scope.length) return a.scope.join(",") === b.scope.join(",");
  return true;
}

// ---------------------------------------------------------------------------------------------
// SQL paths, steps, owners, branches
// ---------------------------------------------------------------------------------------------

export function normalizeSqlPath(p: string): string {
  return tidy(p.replace(/`/g, "").replace(/\\/g, "/"), 300).replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}

/** A step / gate / rollback text as a comparison key. */
export function stepSig(s: string): string {
  return sig(s).slice(0, 240);
}

export function normalizeOwner(o: string | null | undefined): string {
  if (!o) return "";
  return tidy(o, 80).toLowerCase().replace(/[.,;:]+$/g, "").trim();
}

function globToRegExp(p: string): RegExp {
  const esc = p.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, ".{0,200}");
  return new RegExp(`^${esc}$`, "i");
}

export const isPattern = (b: string) => b.includes("*");

/** `origin/x`, `refs/heads/x`, backticks and a trailing dot are not part of a branch name. */
export function normBranch(b: string): string {
  return tidy(b.replace(/`/g, ""), 200)
    .replace(/^refs\/heads\//, "")
    .replace(/^origin\//, "")
    .replace(/[.,;]+$/g, "")
    .trim();
}

/** Equal, or one is a glob (`prod_blue_*`) that matches the other. Two different globs are not compatible. */
export function branchesCompatible(a: string, b: string): boolean {
  const x = normBranch(a);
  const y = normBranch(b);
  if (x.toLowerCase() === y.toLowerCase()) return true;
  if (isPattern(x) && !isPattern(y)) return globToRegExp(x).test(y);
  if (isPattern(y) && !isPattern(x)) return globToRegExp(y).test(x);
  return false;
}
