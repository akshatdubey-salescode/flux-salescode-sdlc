/**
 * The plain-language layer for the free text of the review comments (pure, no React).
 *
 * The agents write one long paragraph per release-page row: evidence tags ([V], [I], [author]), decision tags ((D2)), "unknown (devops)",
 * "a) ... b) ... c) ..." lists, "see row 6" pointers. `plainify` turns such a paragraph into
 *   { lead: one short sentence, bullets: up to 4 short points, more: the rest (collapsed in the UI), pointers: what it only pointed to }.
 * It only REMOVES noise (tags, pointers) and RESTRUCTURES (splits lists and sentences); it never adds a fact and never drops a number, key,
 * PR reference or file name. When it cannot split safely the original sentence stays whole.
 *
 * `makeDeduper()` remembers the sentences already shown (normalised) so that the same fact appears once in one view.
 */

export interface Plain {
  /** The first sentence (<= ~140 characters when it can be split safely). May be "" when the text was only a pointer or only a list. */
  lead: string;
  /** The next points, at most `maxBullets`. */
  bullets: string[];
  /** Points beyond `maxBullets`: shown behind "Show more". */
  more: string[];
  /** Pointers that were removed ("see row 6", "see the release page"), as written. */
  pointers: string[];
}

export interface PlainOptions {
  /** Sentences already shown elsewhere in the same view are dropped (and the ones kept are remembered). */
  dedupe?: Deduper;
  /** Longest lead before it is split at a clause (default 140). */
  maxLead?: number;
  /** Bullets shown before "Show more" (default 4). */
  maxBullets?: number;
}

export const EMPTY_PLAIN: Plain = Object.freeze({ lead: "", bullets: [], more: [], pointers: [] }) as Plain;

// ---------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------

const squash = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Upper-case the first letter ("not known yet" -> "Not known yet"); a key or file name that starts the text keeps its case. */
export function sentenceCase(s: string): string {
  const t = s.trimStart();
  return t && /^[a-z]/.test(t) && !/^[a-z][\w.-]*[._#/][\w.-]/.test(t.split(/\s/)[0]) ? t[0].toUpperCase() + t.slice(1) : t;
}

/** "Not known yet — devops to confirm". */
export function notKnownYet(owner?: string | null): string {
  const o = owner ? squash(owner) : "";
  return o ? `Not known yet — ${o} to confirm` : "Not known yet";
}

const lowerFirst = (s: string): string => (s ? s[0].toLowerCase() + s.slice(1) : s);

/** Split at `sep` outside ( ) groups (a "(" that never closes is plain text). */
function splitOutside(s: string, sep: RegExp): string[] {
  const inside = new Uint8Array(s.length);
  const stack: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 40) {
      if (stack.length < 64) stack.push(i);
    } else if (c === 41 && stack.length > 0) {
      const open = stack.pop() as number;
      if (stack.length === 0 && i - open <= 700) for (let k = open + 1; k < i; k++) inside[k] = 1;
    }
  }
  let masked = "";
  for (let i = 0; i < s.length; i++) masked += inside[i] ? "\u0001" : s[i];
  const re = new RegExp(sep.source, sep.flags.includes("g") ? sep.flags : `${sep.flags}g`);
  const pieces: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    pieces.push(s.slice(last, m.index));
    last = m.index + m[0].length;
  }
  pieces.push(s.slice(last));
  return pieces.map((p) => p.trim()).filter(Boolean);
}

const ABBREV = /\b(?:e\.g|i\.e|vs|etc|approx|incl|no|fig|cf)\.$/i;

/** Sentences: ". " (or "! ", "? ") followed by a capital, digit, "#", "(" or a quote; parentheses protected; "e.g." and "vs." do not end one. */
export function sentencesOf(text: string): string[] {
  const raw = splitOutside(squash(text), /(?<=[.!?])\s+(?=[A-Z0-9#`("'\[]|[a-z][\w.-]*#\d)|\s+(?=(?:Current values|Rollback|Gate|Not verified|Not read|UAT|Re-test)\b[^:.;]{0,40}:\s)/);
  const out: string[] = [];
  for (const p of raw) {
    const prev = out[out.length - 1];
    // "Previous data fix required? YES ...": a question label followed by its answer is one sentence
    if (prev && (ABBREV.test(prev) || (prev.endsWith("?") && prev.length < 90 && /^(?:yes|no|unknown|done|not done|not required)\b/i.test(p)))) out[out.length - 1] += ` ${p}`;
    else out.push(p);
  }
  return out;
}

const stripEnd = (s: string): string => s.replace(/[\s.;,]+$/, "").trim();

// ---------------------------------------------------------------------------------------------
// removing noise
// ---------------------------------------------------------------------------------------------

/** Evidence tags the review agents write: [V] verified, [I] inferred, [author], [author, detail]. */
const EVIDENCE_TAG = /\s?\[(?:V|I|V,\s?I|I,\s?V|author(?:,[^\]]{0,60})?)\]/g;
/** Decision tags: "(D2)", "(D1, D3)". A bare "D2 (" before a parenthesis loses the "D2" only. */
const DECISION_TAG = /\s?\(\s?D\d{1,2}(?:\s?[,/&]\s?D\d{1,2})*\s?\)/g;
const DECISION_LEAD = /\bD\d{1,2}\s+(?=\()/g;

const POINTER_ROWS = String.raw`rows?\s+\d{1,2}(?:\s*(?:,|and|&)\s*\d{1,2})*`;
/** A whole sentence that only points somewhere else. */
const POINTER_SENTENCE = new RegExp(String.raw`^(?:see|refer to|as in|same as)\s+(?:${POINTER_ROWS}|the release page|the checklist|likely to be missed(?:\s+below)?|below|above)\b[^.]*\.?$`, "i");
/** A pointer inside a sentence: "(see row 11)", "(row 11)", "; see row 6", ", see the release page". */
const POINTER_INLINE = new RegExp(String.raw`\s*\((?:see\s+)?${POINTER_ROWS}\)|\s*[;,]?\s*\(?\bsee\s+(?:${POINTER_ROWS}|the release page|likely to be missed(?:\s+below)?)\)?`, "gi");

/** Owners that can be glued to the word "unknown" when the styled word and its owner tag are read as one text ("unknownrelease manager"). */
const GLUED_OWNERS = /\bunknown(?=(?:release manager|devops(?: config compare)?|qa|mobile lead|dba|security(?: owner)?|author|product(?: owner)?|ba|dev(?:eloper)?|test(?:er)?|design(?:er)?|support|owner)\b)/gi;

export interface Cleaned {
  text: string;
  pointers: string[];
}

/** Drop tags, rewrite "unknown (devops)" in words, and cut the pointers out (they are returned apart). */
export function cleanNoise(input: string): Cleaned {
  let t = squash(input ?? "");
  const pointers: string[] = [];
  t = t.replace(EVIDENCE_TAG, "").replace(DECISION_TAG, "").replace(DECISION_LEAD, "");
  t = t.replace(GLUED_OWNERS, "unknown ");
  // unknown, owner to confirm: X  /  how: unknown, devops  /  unknown (devops)
  t = t.replace(/\bunknown,\s?owner to confirm\s?:\s?([^.;,()[\]]{1,60})/gi, (_m, o: string) => lowerFirst(notKnownYet(o.trim())));
  t = t.replace(/\bunknown,\s?([a-z][\w -]{1,30})(?=[).;]|$)/gi, (_m, o: string) => lowerFirst(notKnownYet(o.trim())));
  t = t.replace(/\bunknown\s?\(([^)]{1,60})\)/gi, (_m, o: string) => lowerFirst(notKnownYet(o.trim())));
  // pointers, sentence by sentence
  const kept: string[] = [];
  for (const s of sentencesOf(t)) {
    if (POINTER_SENTENCE.test(s)) {
      pointers.push(stripEnd(s));
      continue;
    }
    kept.push(
      s.replace(POINTER_INLINE, (m) => {
        pointers.push(squash(m).replace(/^[;,]\s?/, "").replace(/^\(|\)$/g, ""));
        return "";
      }),
    );
  }
  t = squash(kept.join(" ")).replace(/\s+([.,;:])/g, "$1").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  // a line cut by the parser can leave "(" open: close it, so no sentence ends inside a bracket
  const open = (t.match(/\(/g) ?? []).length - (t.match(/\)/g) ?? []).length;
  if (open > 0 && open < 4) t += ")".repeat(open);
  // a sentence start left lower-case by a rewrite ("not known yet ...") reads as a sentence
  t = t.replace(/(^|[.!?]\s)not known yet/g, "$1Not known yet");
  return { text: t, pointers };
}

/** The row numbers a pointer names ("see rows 19 and 21" -> [19, 21]). */
export function pointerRows(pointers: readonly string[]): number[] {
  const out: number[] = [];
  for (const p of pointers) for (const m of p.matchAll(/\b(\d{1,2})\b/g)) if (/rows?\b/i.test(p)) out.push(Number(m[1]));
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------------------------
// lists inside one sentence
// ---------------------------------------------------------------------------------------------

const LETTERS = "abcdefgh";

/**
 * Inline enumerations: "a) ... b) ... c) ...", "(1) ... (2) ...", "1) ... 2) ...". The markers must run in order from a / 1 and there must be at
 * least two, so "(3)" or "(a)" on their own are left alone. Returns the text before the first marker and the items.
 */
export function splitEnumeration(text: string): { head: string; items: string[] } | null {
  const re = /(?<![\w/])\(?([a-h]|\d{1,2})\)\s+(?=[^\s)])/g;
  const marks: Array<{ at: number; end: number; tag: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) marks.push({ at: m.index, end: m.index + m[0].length, tag: m[1] });
  for (const kind of ["letter", "number"] as const) {
    const pool = marks.filter((x) => (kind === "letter" ? /^[a-h]$/.test(x.tag) : /^\d+$/.test(x.tag)));
    const startAt = pool.findIndex((x) => (kind === "letter" ? x.tag === "a" : x.tag === "1"));
    if (startAt < 0) continue;
    const chain = [pool[startAt]];
    for (let i = startAt + 1; i < pool.length; i++) {
      const prev = chain[chain.length - 1].tag;
      const want = kind === "letter" ? LETTERS[LETTERS.indexOf(prev) + 1] : String(Number(prev) + 1);
      if (pool[i].tag === want) chain.push(pool[i]);
    }
    if (chain.length < 2) continue;
    const items = chain.map((c, i) => stripEnd(text.slice(c.end, i + 1 < chain.length ? chain[i + 1].at : text.length))).filter(Boolean);
    if (items.length < 2) continue;
    return { head: text.slice(0, chain[0].at).trim(), items };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// plainify
// ---------------------------------------------------------------------------------------------

/** One sentence longer than `max`: its first clause (up to `max`) and the rest, or the sentence whole when no safe split exists. */
function splitLong(s: string, max: number): string[] {
  if (s.length <= max * 1.15) return [s];
  for (const sep of [/;\s+/, /\s[—–]\s|\s-\s/, /:\s+(?=\S)/]) {
    let parts = splitOutside(s, sep);
    if (parts.length < 2) continue;
    // a colon splits once ("label: the rest"), and a question label ("... required?") is not a lead
    if (sep.source.startsWith(":")) parts = [parts[0], parts.slice(1).join(": ")];
    if (parts[0].endsWith("?")) continue;
    let lead = parts[0];
    let i = 1;
    const glue = sep.source.startsWith(";") ? "; " : null;
    while (glue && i < parts.length - 1 && lead.length + glue.length + parts[i].length <= max) lead += glue + parts[i++];
    if (lead.length >= 24 && lead.length <= max * (sep.source.startsWith(";") ? 1.7 : 1.15)) return [stripEnd(lead), ...parts.slice(i).map(stripEnd)].filter(Boolean);
  }
  return [s];
}

function build(lead: string, rest: string[], pointers: string[], maxBullets: number): Plain {
  const all = rest.map(stripEnd).filter(Boolean);
  return { lead: stripEnd(lead), bullets: all.slice(0, maxBullets), more: all.slice(maxBullets), pointers };
}

/** Make `text` readable: see the module comment. `plainify("")` is the empty Plain. */
export function plainify(text: string | null | undefined, opts: PlainOptions = {}): Plain {
  const maxLead = opts.maxLead ?? 140;
  const maxBullets = opts.maxBullets ?? 4;
  const { text: t, pointers } = cleanNoise(text ?? "");
  if (!t) return { ...EMPTY_PLAIN, pointers };
  let plain: Plain;
  const en = splitEnumeration(t);
  if (en) {
    const head = sentencesOf(en.head);
    const lead = head.length ? head[0] : "";
    const rest = [...(head.length > 1 ? head.slice(1) : []), ...en.items];
    plain = build(lead, rest.flatMap((x) => (x === lead ? [] : [x])), pointers, maxBullets);
  } else {
    const ss = sentencesOf(t);
    const first = ss[0];
    const semi = splitOutside(first, /;\s+/);
    if (semi.length >= 3 && semi.every((p) => p.length >= 3)) {
      // "Check: admin (...); distributor (...); supervisor above; salesman (...)": the label is the lead, each clause a point
      const colon = /^([^:]{3,60}):\s+(.+)$/.exec(semi[0]);
      const pieces = colon ? [colon[2], ...semi.slice(1)] : semi.slice(1);
      plain = build(colon ? `${colon[1]}:` : semi[0], [...pieces, ...ss.slice(1)], pointers, maxBullets);
    } else {
      const lead = splitLong(first, maxLead);
      plain = build(lead[0], [...lead.slice(1), ...ss.slice(1)], pointers, maxBullets);
    }
  }
  if (plain.lead.endsWith(":") && plain.bullets.length === 0 && plain.more.length === 0) plain.lead = plain.lead.slice(0, -1);
  return opts.dedupe ? opts.dedupe.take(plain) : plain;
}

/** Every sentence of a Plain, in order (lead, bullets, more). */
export function plainLines(p: Plain): string[] {
  return [p.lead, ...p.bullets, ...p.more].filter(Boolean);
}

/** True when nothing is left to show. */
export const isEmptyPlain = (p: Plain): boolean => plainLines(p).length === 0;

/** A Plain as text for the clipboard: the lead, then "- point" lines (all of them, including those behind "Show more"). */
export function plainCopy(p: Plain, indent = ""): string[] {
  const out: string[] = [];
  const pts = [...p.bullets, ...p.more];
  if (p.lead) out.push(`${indent}${p.lead}`);
  for (const b of pts) out.push(`${indent}${p.lead ? "  " : ""}- ${b}`);
  return out;
}

/** One line: the lead and the points joined by "; ". */
export function plainOneLine(p: Plain): string {
  return plainLines(p).map(stripEnd).join("; ");
}

// ---------------------------------------------------------------------------------------------
// the deduper
// ---------------------------------------------------------------------------------------------

/** Normalised form of a sentence: lower case, tags and punctuation gone, so "Previous data fix required? YES x" equals "Previous data fix required?: Yes x". */
export function sentenceKey(s: string): string {
  return s
    .toLowerCase()
    .replace(EVIDENCE_TAG, "")
    .replace(/[^a-z0-9]+/g, "");
}

export interface Deduper {
  /** True when this sentence (or a longer one that contains it) was already shown. */
  has(sentence: string): boolean;
  /** Remember a sentence. */
  add(sentence: string): void;
  /** Keep the sentences of `p` that are new (remembering them); the first kept point becomes the lead when the lead was a repeat. */
  take(p: Plain): Plain;
  /** How many sentences were dropped as repeats (for tests and the "nothing repeated" check). */
  readonly dropped: number;
}

const MIN_CONTAINED = 24;

export function makeDeduper(): Deduper {
  const seen = new Set<string>();
  let dropped = 0;
  const has = (s: string): boolean => {
    const k = sentenceKey(s);
    if (k.length < 4) return false;
    if (seen.has(k)) return true;
    if (k.length < MIN_CONTAINED) return false;
    for (const x of seen) {
      if (x.length > k.length && x.includes(k)) return true;
      // the same sentence with a short label in front ("Check: ...")
      if (x.length >= MIN_CONTAINED && k.length > x.length && k.length - x.length <= 10 && k.includes(x)) return true;
    }
    return false;
  };
  const add = (s: string): void => {
    const k = sentenceKey(s);
    if (k.length >= 4) seen.add(k);
  };
  const take = (p: Plain): Plain => {
    const lines = plainLines(p);
    const kept: string[] = [];
    let leadKept = false;
    lines.forEach((s, i) => {
      if (has(s)) {
        dropped++;
        return;
      }
      add(s);
      kept.push(s);
      if (i === 0 && p.lead) leadKept = true;
    });
    // a lead that is only a label ("Check:") whose points were all repeats goes too
    if (kept.length === 1 && kept[0].endsWith(":") && lines.length > 1) {
      kept.length = 0;
      dropped++;
      leadKept = false;
    }
    const lead = leadKept ? kept[0] : (kept[0] ?? "");
    const rest = kept.slice(1);
    const max = Math.max(p.bullets.length, 1);
    return { lead, bullets: rest.slice(0, max), more: rest.slice(max), pointers: p.pointers };
  };
  return {
    has,
    add,
    take,
    get dropped() {
      return dropped;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// status in plain words
// ---------------------------------------------------------------------------------------------

export type Verdict = "Ready" | "Held" | "Partly reviewed" | "Blocked" | "Not stated";

/**
 * The review status line in plain words: "HELD in the DEMO movement (blocked) · PARTIAL (prod setting values not in any file)" ->
 * verdict "Held", reason "Held in the DEMO movement (blocked). Partly reviewed: prod setting values not in any file".
 */
export function plainStatus(word: string | null, statusText: string | null): { verdict: Verdict; reason: Plain } {
  const w = (word ?? "").toUpperCase();
  const verdict: Verdict = w === "HELD" ? "Held" : w === "PARTIAL" ? "Partly reviewed" : w === "BLOCKED" ? "Blocked" : w === "READY" ? "Ready" : "Not stated";
  let t = squash(statusText ?? "");
  t = t.replace(/\bHELD\b/g, "Held").replace(/\bBLOCKED\b/g, "Blocked").replace(/\bREADY\b/g, "Ready").replace(/\bNOT READY\b/g, "Not ready");
  t = t.replace(/\bPARTIAL\b(\s*\()?/g, (_m, paren: string | undefined) => (paren ? "Partly reviewed: " : "Partly reviewed"));
  t = t.replace(/(Partly reviewed: [^()]*)\)/, "$1");
  const pieces = t.split(/\s[·|]\s/).map((x) => x.trim()).filter(Boolean);
  const parts = pieces.map((p) => plainify(p, { maxLead: 400 }));
  const lines = parts.flatMap((p) => plainLines(p));
  // the verdict chip already says "Held": the reason starts after it ("in the DEMO movement (blocked)")
  if (lines[0]) lines[0] = lines[0].replace(/^(?:Held|Blocked|Ready|Not ready)\b\s*/, "").replace(/^[-:—]\s*/, "");
  return { verdict, reason: { lead: lines[0] ?? "", bullets: lines.slice(1, 5), more: lines.slice(5), pointers: [] } };
}
