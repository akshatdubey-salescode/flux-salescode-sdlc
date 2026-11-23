/**
 * Small pure helpers shared by the record parser modules.
 *
 * Performance rule for this whole folder: user text is hostile. Every text that reaches a regex
 * has first been through `cleanText` (whitespace runs collapsed, words capped at MAX_TOKEN
 * characters) and a length cap; regexes use bounded quantifiers; trailing trims are manual loops.
 * No regex here can therefore backtrack over more than a few hundred characters per start.
 */
import type { PrRef } from "./types";

export const MAX_TOKEN = 200;

/** Words that are not repository names when they stand in front of `#12`. */
export const NOT_REPO = new Set([
  "pr",
  "pull",
  "issue",
  "ticket",
  "see",
  "item",
  "step",
  "no",
  "number",
  "and",
  "or",
  "also",
  "plus",
  "the",
  "with",
  "closed",
  "open",
  "merged",
  // words that precede a bare "#1147" in a sentence ("merged before #1147", "reverted by #269", "merge #1181", "close #1345")
  "before",
  "after",
  "inside",
  "outside",
  "within",
  "without",
  "behind",
  "by",
  "of",
  "in",
  "on",
  "at",
  "to",
  "into",
  "from",
  "via",
  "per",
  "as",
  "so",
  "if",
  "is",
  "was",
  "are",
  "then",
  "than",
  "but",
  "not",
  "for",
  "this",
  "that",
  "since",
  "until",
  "because",
  "while",
  "under",
  "over",
  "same",
  "only",
  "still",
  "merge",
  "merges",
  "close",
  "closes",
  "fix",
  "fixes",
  "fixed",
  "revert",
  "reverts",
  "reverted",
  "reopen",
  "supersedes",
  "superseded",
  "duplicate",
  "duplicates",
  "except",
  "including",
]);

/**
 * `salescode-ai/channelkart-flutter`, `https://github.com/salescode-ai/channelkart-flutter.git`
 * and `channelkart-flutter` all become `channelkart-flutter`.
 */
export function normalizeRepo(raw: string): string {
  let s = raw.length > 300 ? raw.slice(0, 300) : raw;
  s = s.trim().toLowerCase();
  s = s.replace(/^https?:\/\/[^/]{1,100}\//, "").replace(/\.git$/, "").replace(/[`'"]/g, "");
  const parts = s.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : s;
}

/** Identity of a PR across records: `channelkart-flutter#49`. */
export function prKey(repo: string, pr: number): string {
  return `${normalizeRepo(repo)}#${pr}`;
}

const isDigit = (c: number) => c >= 48 && c <= 57;
const isLetter = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isWord = (c: number) => isDigit(c) || isLetter(c) || c === 95;
const isRepoChar = (c: number) => isWord(c) || c === 46 || c === 45;

/** Remove trailing characters in `chars` (manual loop: no backtracking). */
export function trimEndChars(s: string, chars: string): string {
  let e = s.length;
  while (e > 0 && chars.includes(s[e - 1])) e--;
  return e === s.length ? s : s.slice(0, e);
}

/** Trailing whitespace, dots and semicolons removed; surrounding whitespace trimmed. */
export function trimDot(s: string): string {
  return trimEndChars(s.trim(), " \t\n\r.;").trim();
}

export function capStr(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}

export interface RefPos extends PrRef {
  start: number;
  end: number;
}

/**
 * `repo#12` / `repo #12` references with their position. Found by walking the `#` characters
 * and reading the repo token backwards (<= 80 chars), so it is linear whatever the text holds.
 * Words like "PR #12" or "and #12" are not repos.
 */
export function refsWithPos(text: string, limit = 40): RefPos[] {
  const out: RefPos[] = [];
  const seen = new Set<string>();
  let from = 0;
  while (out.length < limit) {
    const h = text.indexOf("#", from);
    if (h < 0) break;
    from = h + 1;
    let j = h + 1;
    while (j < text.length && j - h <= 7 && isDigit(text.charCodeAt(j))) j++;
    const nd = j - h - 1;
    if (nd < 1 || nd > 6) continue;
    if (j < text.length && isWord(text.charCodeAt(j))) continue; // \b
    let e = h;
    if (e > 0 && text[e - 1] === " ") e--;
    let s = e;
    while (s > 0 && e - s < 80 && isRepoChar(text.charCodeAt(s - 1))) s--;
    while (s < e && !isLetter(text.charCodeAt(s))) s++;
    if (s >= e) continue;
    const repo = normalizeRepo(trimEndChars(text.slice(s, e), ".-"));
    // a repository name is not an English word ("by #269", "of #1341", "before #1147")
    if (!repo || NOT_REPO.has(repo)) continue;
    const pr = parseInt(text.slice(h + 1, j), 10);
    const k = `${repo}#${pr}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ repo, pr, start: s, end: j });
  }
  return out;
}

export function refsIn(text: string, limit = 40): PrRef[] {
  return refsWithPos(text, limit).map(({ repo, pr }) => ({ repo, pr }));
}

/**
 * Linear text sanitiser. Collapses runs of spaces/tabs/nbsp to `maxRun` characters (1 by
 * default), drops control characters, caps every word at MAX_TOKEN characters and, with
 * `squeeze`, turns any run of line breaks (and the blanks around them) into a single "\n".
 */
export function cleanText(s: string, maxRun = 1, squeeze = false): string {
  const parts: string[] = [];
  let ws = 0;
  let tok = 0;
  let nl = false; // inside a run of line breaks/blanks (squeeze mode)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 10) {
      if (squeeze) {
        if (!nl) parts.push("\n");
        nl = true;
      } else parts.push("\n");
      ws = 0;
      tok = 0;
    } else if (c === 32 || c === 9 || c === 13 || c === 0xa0) {
      ws++;
      tok = 0;
      if (squeeze && nl) continue;
      if (ws <= maxRun) parts.push(" ");
    } else if (c < 32 || c === 0x7f) {
      continue;
    } else {
      nl = false;
      ws = 0;
      tok++;
      if (tok <= MAX_TOKEN) parts.push(s[i]);
    }
  }
  return parts.join("");
}

const stripCache = new Map<string, string>();

/** Remove evidence tags `[V]`, `[I]`, `[author]`, `[author, detail]` and tidy spaces. */
export function stripTags(s: string): string {
  // Every extractor strips the same section text: keep the last few results of long inputs.
  const long = s.length > 2000;
  if (long) {
    const hit = stripCache.get(s);
    if (hit !== undefined) return hit;
  }
  const out = stripTagsUncached(s);
  if (long) {
    if (stripCache.size >= 24) stripCache.delete(stripCache.keys().next().value as string);
    stripCache.set(s, out);
  }
  return out;
}

function stripTagsUncached(s: string): string {
  const t = cleanText(s).replace(/ ?\[(?:V|I|author)(?:,[^\]\n]{0,80})?\]/g, "");
  return cleanText(t.replace(/ ([.,;])/g, "$1")).trim();
}

/** Lowercase alphanumerics only: for tolerant equality checks of free-text values. */
export function squash(s: string): string {
  return s.slice(0, 500).toLowerCase().replace(/[^a-z0-9*]+/g, "");
}

/** Two values agree when one contains the other once squashed ("off" vs "off (nothing changes)"). */
export function agree(a: string, b: string): boolean {
  const x = squash(a);
  const y = squash(b);
  if (!x || !y) return true;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

export function asString(v: unknown): string | null {
  if (typeof v === "string") return v.trim() ? capStr(v.trim(), 500) : null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

export function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Split `s` on `sep` but only outside parentheses, so "(a; b)" and nested "(x (y); z)" stay in
 * one piece. Matched groups of up to 500 characters are masked with a stack (linear); a "(" that
 * never closes is plain text.
 */
export function splitOutsideParens(s: string, sep: RegExp): string[] {
  const inside = new Uint8Array(s.length);
  const stack: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 40) {
      if (stack.length < 64) stack.push(i);
    } else if (c === 41 && stack.length > 0) {
      const open = stack.pop() as number;
      if (stack.length === 0 && i - open <= 501) for (let k = open + 1; k < i; k++) inside[k] = 1;
    }
  }
  let masked = "";
  for (let i = 0; i < s.length; i++) masked += inside[i] ? "\u0001" : s[i];
  const re = new RegExp(sep.source, sep.flags.includes("g") ? sep.flags : sep.flags + "g");
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

/** `s` without its outermost parenthesised part(s): "Slake (executor; how: unknown (devops))" => "Slake ". */
export function outsideParens(s: string): string {
  let depth = 0;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")" && depth > 0) depth--;
    else if (depth === 0) out += c;
  }
  return out;
}

/** Sentences: split at ". " before a capital, digit, backtick or paren; parentheses protected. */
export function sentences(s: string): string[] {
  return splitOutsideParens(s.replace(/\n+/g, " "), /\.\s+(?=[A-Z0-9`(\[])/);
}

/**
 * Text from `from` to the end of the sentence: the first ". " followed by a capital letter, a
 * line break, or `max` characters.
 */
export function untilSentence(text: string, from: number, max = 300): string {
  const end = Math.min(text.length, from + max);
  for (let i = from; i < end; i++) {
    const c = text[i];
    if (c === "\n") return text.slice(from, i);
    if (c === "." && text[i + 1] === " ") {
      const n = text.charCodeAt(i + 2);
      if (n >= 65 && n <= 90) return text.slice(from, i);
    }
  }
  return text.slice(from, end);
}

/**
 * Resolve a written repo alias ("flutter", "auth-service") against the full repo names known
 * from the record itself, by UNIQUE suffix match ("salescode-auth-service" ends with
 * "-auth-service"). Names already in the pool, and ambiguous or unmatched ones, are returned as is.
 */
export function resolveAlias(repo: string, pool: Set<string>): string {
  if (pool.has(repo)) return repo;
  let hit: string | null = null;
  for (const p of pool) {
    if (p.endsWith("-" + repo) || p.endsWith("_" + repo)) {
      if (hit !== null) return repo;
      hit = p;
    }
  }
  return hit ?? repo;
}
