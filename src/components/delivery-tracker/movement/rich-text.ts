/**
 * Pure parsing of the free text that comes out of the review comments, for display: links (Jira keys, GitHub PR references, http(s) URLs) and
 * state words (Done, Not done, Not required, N/A, Yes / No, unknown (owner)). It returns SEGMENTS; the React side renders each one as plain text or
 * as a styled / linked element, so nothing here (or there) ever builds HTML from the text.
 */

/** The GitHub organisation a `repo#n` reference belongs to when it names no owner (`owner/repo#n` overrides it). One place. */
export const GITHUB_DEFAULT_OWNER = "salescode-ai";

/** Look like Jira keys but are not (UTF-8, ISO-27001, SHA-256 ...). */
export const NON_JIRA_PREFIXES: ReadonlySet<string> = new Set(["UTF", "ISO", "SHA", "RFC", "IEEE", "AES", "RSA", "MD", "TLS", "SSL", "ANSI", "DES", "PKCS", "TCP", "UDP", "DNS", "HTTP", "UTC", "GMT", "IST", "PCI", "GDPR", "SOC", "NIST", "ECMA", "BASE"]);

export interface LinkContext {
  /** `https://org.atlassian.net`; null/unusable = Jira keys stay plain text. */
  jiraBaseUrl: string | null;
}

export type LinkSegment =
  | { type: "text"; text: string }
  | { type: "jira"; text: string; href: string }
  | { type: "pr"; text: string; href: string }
  | { type: "url"; text: string; href: string };

// A reference must not start in the middle of a word, a path or another reference.
const LEAD = String.raw`(?<![A-Za-z0-9_/.#@-])`;
const URL_PART = String.raw`(?<url>https?:\/\/[^\s<>"'\`]+)`;
const PR_PART = String.raw`(?:(?<owner>[A-Za-z0-9][A-Za-z0-9._-]*)\/)?(?<repo>[A-Za-z0-9][A-Za-z0-9._-]*)#(?<num>\d{1,6})(?![A-Za-z0-9_-])`;
const JIRA_PART = String.raw`(?<jira>[A-Z][A-Z0-9]{1,9}-\d{1,6})(?![A-Za-z0-9_-])`;
const LINK_RE = new RegExp(`${URL_PART}|${LEAD}(?:${PR_PART}|${JIRA_PART})`, "g");

function safeBase(base: string | null): string | null {
  return base && /^https?:\/\//i.test(base) ? base.replace(/\/+$/, "") : null;
}

/**
 * Splits `text` into plain text, Jira links, GitHub PR links and URLs.
 * - Jira `CAV-7280` -> `<jiraBaseUrl>/browse/CAV-7280` (plain text without a usable base URL, and for UTF-8 / ISO-27001 style prefixes);
 * - PR `repo#12` or `owner/repo#12` -> `https://github.com/<owner>/<repo>/pull/12`, owner defaulting to GITHUB_DEFAULT_OWNER;
 * - an http(s) URL already in the text -> itself (trailing punctuation left outside);
 * - NOT linked: an alias without a repo (`executor #931`, `#931`), `v2.1-3`, anything inside a longer identifier.
 */
export function linkifySegments(text: string, ctx: LinkContext): LinkSegment[] {
  const out: LinkSegment[] = [];
  const base = safeBase(ctx.jiraBaseUrl);
  let last = 0;
  const push = (t: string) => {
    if (!t) return;
    const prev = out[out.length - 1];
    if (prev && prev.type === "text") prev.text += t;
    else out.push({ type: "text", text: t });
  };
  for (const m of text.matchAll(LINK_RE)) {
    const at = m.index ?? 0;
    const g = m.groups ?? {};
    let seg: LinkSegment | null = null;
    let raw = m[0];
    if (g.url) {
      // keep sentence punctuation (and an unbalanced closing bracket) outside the link
      let u = g.url;
      while (/[.,;:!?)\]]$/.test(u) && !(u.endsWith(")") && (u.match(/\(/g) ?? []).length >= (u.match(/\)/g) ?? []).length)) u = u.slice(0, -1);
      raw = u;
      try {
        const parsed = new URL(u);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") seg = { type: "url", text: u, href: parsed.toString() };
      } catch {
        seg = null;
      }
    } else if (g.num) {
      const repo = g.repo;
      if (/[A-Za-z]/.test(repo)) seg = { type: "pr", text: m[0], href: `https://github.com/${encodeURIComponent(g.owner ?? GITHUB_DEFAULT_OWNER)}/${encodeURIComponent(repo)}/pull/${g.num}` };
    } else if (g.jira) {
      const prefix = g.jira.split("-")[0];
      if (base && !NON_JIRA_PREFIXES.has(prefix)) seg = { type: "jira", text: g.jira, href: `${base}/browse/${encodeURIComponent(g.jira)}` };
    }
    push(text.slice(last, at));
    if (seg) out.push(seg);
    else push(raw);
    last = at + raw.length;
  }
  push(text.slice(last));
  return out;
}

// ---------------------------------------------------------------------------------------------
// state words
// ---------------------------------------------------------------------------------------------

export type StateKind = "done" | "notdone" | "na" | "yesno" | "unknown";

export type StateSegment = { type: "text"; text: string } | { type: "state"; text: string; state: StateKind; owner: string | null };

// A state token must not sit inside an identifier (done_at, Undone, N/A-1 ...).
const BEFORE_OK = /[^A-Za-z0-9_#/.-]$|^$/;
const AFTER_OK = /^$|^[^A-Za-z0-9_-]/;

type Rule = { re: RegExp; state: StateKind; upper?: boolean; owner?: boolean };

/** Tokens that count anywhere in a text (they are the records' own state vocabulary). `upper`: the first letter must be a capital (so prose like "was not done" stays prose). */
const EMBEDDED: Rule[] = [
  { re: /^unknown \(([^)]{1,40})\)/i, state: "unknown", owner: true },
  { re: /^not done/i, state: "notdone", upper: true },
  { re: /^not required/i, state: "na", upper: true },
  { re: /^n\/a/i, state: "na" },
  { re: /^NA(?=$|[^A-Za-z0-9_-])/, state: "na" },
];

/** Bare words that count only as the FIRST word of a text or right after a `label: ` (so "yes" mid-sentence is left alone). */
const LEADING: Rule[] = [
  { re: /^done/i, state: "done", upper: true },
  { re: /^unknown/i, state: "unknown", upper: true },
];

/** Yes / No are plain English at the start of a sentence ("No review comment found"), so they count only right after a `label: `. */
const AFTER_LABEL_ONLY: Rule[] = [
  { re: /^yes/i, state: "yesno", upper: true },
  { re: /^no/i, state: "yesno", upper: true },
];

function matchRule(rules: Rule[], rest: string): { len: number; state: StateKind; owner: string | null } | null {
  for (const r of rules) {
    const m = r.re.exec(rest);
    if (!m) continue;
    if (r.upper && !/[A-Z]/.test(m[0][0])) continue;
    if (!AFTER_OK.test(rest.slice(m[0].length))) continue;
    return { len: m[0].length, state: r.state, owner: r.owner ? m[1].trim() : null };
  }
  return null;
}

/**
 * Where a "leading" state word may start: the very start of the text, and right after a `label: ` (label of up to 60 characters) that itself starts
 * the text or follows a `;`, `|`, `·` or a line break ("Deploy: Done; Rollback: Not done").
 */
function leadingStarts(text: string): Set<number> {
  const out = new Set<number>([0]);
  for (const m of text.matchAll(/(?:^|[;|·\n]\s*)[^:;|·\n]{1,60}:[ \t]+/g)) out.add((m.index ?? 0) + m[0].length);
  return out;
}

/**
 * Splits `text` into plain text and state words:
 *   "Done none" -> [Done][ none];  "Rollback: Not done, see QA" -> [Rollback: ][Not done][, see QA];
 *   "Config X: unknown (QA)" -> [..][unknown (QA)] with owner "QA";  "N/A", "NA", "Not Required" -> grey.
 * Case-insensitive for the multi-word tokens (a capital first letter is required so lower-case prose is not styled), word-bounded, never inside identifiers.
 */
export function parseStateWords(text: string): StateSegment[] {
  const out: StateSegment[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push({ type: "text", text: plain });
    plain = "";
  };
  const starts = leadingStarts(text);
  const isStart = (i: number) => starts.has(i);
  const isAfterLabel = (i: number) => i > 0 && starts.has(i);
  let i = 0;
  while (i < text.length) {
    const before = text.slice(Math.max(0, i - 1), i);
    const rest = text.slice(i);
    let hit: ReturnType<typeof matchRule> = null;
    if (BEFORE_OK.test(before)) hit = matchRule(EMBEDDED, rest) ?? (isStart(i) ? matchRule(LEADING, rest) : null) ?? (isAfterLabel(i) ? matchRule(AFTER_LABEL_ONLY, rest) : null);
    if (hit) {
      flush();
      out.push({ type: "state", text: text.slice(i, i + hit.len), state: hit.state, owner: hit.owner });
      i += hit.len;
    } else {
      plain += text[i];
      i++;
    }
  }
  flush();
  return out;
}

/** Links first, then state words inside the plain-text pieces: one text can hold both. */
export type RichSegment = LinkSegment | Extract<StateSegment, { type: "state" }>;

export function richSegments(text: string, ctx: LinkContext): RichSegment[] {
  const out: RichSegment[] = [];
  for (const seg of linkifySegments(text, ctx)) {
    if (seg.type !== "text") out.push(seg);
    else for (const s of parseStateWords(seg.text)) out.push(s);
  }
  return out;
}
