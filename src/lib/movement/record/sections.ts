/**
 * Section splitting: `**<number> <title>:**` paragraphs -> RecordSection[].
 *
 * Number is the primary identity, the title is a fuzzy fallback (see CanonicalSection). Unknown
 * or extra sections (a "15 ...", a renamed one) are kept with `canonical: null`. A heading is
 * accepted bold (`**8 Configs:**`), as a markdown heading, or as a plain line-start `8 Configs:`
 * whose title names a known section; unicode-bold digits are normalised (NFKC) first.
 */
import type {
  Block,
  CanonicalSection,
  RecordSection,
  Run,
  SectionTable,
  SectionTag,
  UnknownItem,
} from "./types";
import { cleanText } from "./util";

const MAX_SECTIONS = 60;
const MAX_SECTION_CHARS = 20_000;
const MAX_TAGS_PER_SECTION = 60;
const MAX_UNKNOWNS = 200;
const HEAD_LOOK = 160;

const BY_NUMBER: Record<number, CanonicalSection> = {
  1: "header",
  2: "branches",
  3: "prodBranch",
  4: "deploy",
  5: "restart",
  6: "appRelease",
  7: "database",
  8: "configs",
  9: "roles",
  10: "compat",
  11: "order",
  12: "testing",
  13: "risks",
  14: "verify",
};

/** Ordered: the first matching title wins ("Services to restart" before generic "deploy"). */
const TITLE_RULES: Array<[RegExp, CanonicalSection]> = [
  [/restart/i, "restart"],
  [/services?\s{1,4}to\s{1,4}deploy|deploy\s{1,4}services?/i, "deploy"],
  [/order|gates?\b|rollback/i, "order"],
  [/prod(uction)?\s{1,4}branch|cherry/i, "prodBranch"],
  [/branch/i, "branches"],
  [/config/i, "configs"],
  [/database|\bdb\b|\bsql\b/i, "database"],
  [/\broles?\b/i, "roles"],
  [/backward|compat/i, "compat"],
  [/testing|evidence|sign-?off/i, "testing"],
  [/risk|open items/i, "risks"],
  [/verif|post-?deploy/i, "verify"],
  [/app\s{1,4}release|mobile/i, "appRelease"],
  [/header|summary/i, "header"],
];

export function canonicalByTitle(title: string): CanonicalSection | null {
  const t = title.length > 120 ? title.slice(0, 120) : title;
  for (const [re, c] of TITLE_RULES) if (re.test(t)) return c;
  return null;
}

/** Number is primary; a title that clearly names ANOTHER known section wins (renumbered template). */
export function resolveCanonical(number: number, title: string): CanonicalSection | null {
  const byNum = BY_NUMBER[number] ?? null;
  const byTitle = canonicalByTitle(title);
  if (byNum && (byTitle === null || byTitle === byNum)) return byNum;
  if (byTitle) return byTitle;
  return byNum;
}

export function titleMismatch(number: number, title: string): boolean {
  const byNum = BY_NUMBER[number] ?? null;
  const byTitle = canonicalByTitle(title);
  return !!byNum && !!byTitle && byNum !== byTitle;
}

// ---------------------------------------------------------------------------------------------

const MARKER_RE = /^\s{0,8}(\d{1,2})[.)]?\s{1,8}(.{1,90})$/;

interface SectionStart {
  number: number;
  title: string;
  /** What follows the heading inside the same paragraph. */
  rest: Run[];
}

/** Accepts a start only when it is plausibly the next section (see `makeAccept`). */
type Accept = (number: number, title: string) => boolean;

/** Titles that START with a known template section name ("Configs to move to prod", "Roles to test"). */
const TEMPLATE_START: Array<[RegExp, CanonicalSection]> = [
  [/^services?\s{1,4}to\s{1,4}restart/i, "restart"],
  [/^services?\s{1,4}to\s{1,4}deploy/i, "deploy"],
  [/^(deploy\s{1,4})?(order|gates)\b/i, "order"],
  [/^prod(uction)?\s{1,4}branch/i, "prodBranch"],
  [/^branch/i, "branches"],
  [/^config/i, "configs"],
  [/^(database|db\b|sql\b)/i, "database"],
  [/^roles?\b/i, "roles"],
  [/^(backward|compat)/i, "compat"],
  [/^testing\b/i, "testing"],
  [/^(risks?\b|open items)/i, "risks"],
  [/^(post-?deploy|verif)/i, "verify"],
  [/^(app|mobile)\s{1,4}release/i, "appRelease"],
  [/^(header|summary)\b/i, "header"],
];

function startsTemplate(title: string): boolean {
  const t = title.trim().slice(0, 60);
  return TEMPLATE_START.some(([re]) => re.test(t));
}

/**
 * A heading starts a section only when it is the next number (`current + 1`), when a skipped
 * number is skipped over by a title that really is that section's template title, or when the
 * title STARTS with a known template name (a renumbered template, e.g. "9 Configs ..." before
 * "8 Roles ..."). Keyword containment alone never does: "**7 days later:**" or
 * "**3 weeks of testing:**" are ordinary bold text.
 */
function makeAccept(current: () => number): Accept {
  return (n, title) => {
    const cur = current();
    if (n === cur + 1) return true;
    if (n > cur + 1 && BY_NUMBER[n] !== undefined && canonicalByTitle(title) === BY_NUMBER[n]) return true;
    return startsTemplate(title);
  };
}

function stripColon(s: string): string {
  let e = s.length;
  while (e > 0 && (s[e - 1] === ":" || s[e - 1] === " ")) e--;
  return s.slice(0, e).trim();
}

/** The first ~HEAD_LOOK characters of runs[from..], and the number of runs they touch. */
function headOf(runs: Run[], from: number): string {
  let out = "";
  for (let k = from; k < runs.length && out.length < HEAD_LOOK; k++) out += runs[k].text;
  return out.slice(0, HEAD_LOOK);
}

/** Drop the first `offset` characters of runs[from..]. */
function cutRuns(runs: Run[], from: number, offset: number): Run[] {
  const out: Run[] = [];
  let left = offset;
  for (let k = from; k < runs.length; k++) {
    const r = runs[k];
    if (left >= r.text.length) {
      left -= r.text.length;
      continue;
    }
    out.push(left > 0 ? { ...r, text: r.text.slice(left) } : r);
    left = 0;
  }
  return out;
}

function matchRunsStart(runs: Run[], from: number, isHeading: boolean, accept: Accept): SectionStart | null {
  let k = from;
  while (k < runs.length && !runs[k].text.trim()) k++;
  const first = runs[k];
  if (!first) return null;

  if (first.bold || isHeading) {
    const headText = (isHeading ? headOf(runs, k) : first.text.slice(0, HEAD_LOOK)).normalize("NFKC");
    const m = MARKER_RE.exec(headText.replace(/\n/g, " "));
    if (!m) return null;
    const hasColon = /:\s{0,8}$/.test(headText);
    let rest = isHeading ? [] : runs.slice(k + 1);
    if (!hasColon && !isHeading) {
      // `**1 Header**:` - the colon sits in the next run.
      const next = rest[0];
      if (!next || !/^\s{0,8}:/.test(next.text)) return null;
      rest = [{ ...next, text: next.text.replace(/^\s{0,8}:\s{0,8}/, "") }, ...rest.slice(1)];
    }
    const title = stripColon(m[2]);
    const number = parseInt(m[1], 10);
    if (!title || !accept(number, title)) return null;
    return { number, title, rest };
  }

  // Plain line-start heading: "8 Configs to move to prod: ..." (unbold, maybe unicode-bold digits).
  const head = headOf(runs, k);
  const colon = head.indexOf(":");
  if (colon < 3) return null;
  const m = MARKER_RE.exec(head.slice(0, colon).normalize("NFKC"));
  if (!m) return null;
  const title = stripColon(m[2]);
  const number = parseInt(m[1], 10);
  if (!title || canonicalByTitle(title) === null || !accept(number, title)) return null;
  const rest = cutRuns(runs, k, colon + 1);
  return { number, title, rest };
}

/**
 * A plain run holding "x\n2 Branches: y" is cut after the line break when a digit (or a
 * non-ASCII digit such as a unicode-bold one) follows, so a heading after a hard break is seen at
 * a line start whether the break was a hardBreak node or a "\n" inside one text node.
 */
function splitAtLineBreaks(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (r.bold || !r.text.includes("\n") || out.length >= 4000) {
      out.push(r);
      continue;
    }
    let from = 0;
    let p = r.text.indexOf("\n");
    while (p >= 0 && out.length < 4000) {
      let q = p + 1;
      while (q < r.text.length && (r.text[q] === " " || r.text[q] === "\t")) q++;
      const c = q < r.text.length ? r.text.charCodeAt(q) : 0;
      if ((c >= 48 && c <= 57) || c > 127) {
        out.push({ ...r, text: r.text.slice(from, p + 1) });
        from = p + 1;
      }
      p = r.text.indexOf("\n", p + 1);
    }
    out.push(from === 0 ? r : { ...r, text: r.text.slice(from) });
  }
  return out;
}

/** Split one paragraph where a section heading starts mid-paragraph at a line start. */
function splitParagraph(input: Run[], accept: Accept): Run[][] {
  const runs = splitAtLineBreaks(input);
  const chunks: Run[][] = [];
  let cur: Run[] = [];
  let atLineStart = false;
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k];
    if (atLineStart && cur.length > 0 && matchRunsStart(runs, k, false, accept)) {
      const last = cur[cur.length - 1];
      cur[cur.length - 1] = { ...last, text: last.text.trimEnd() };
      chunks.push(cur);
      cur = [];
    }
    cur.push(r);
    // Line start: this run ends in a line break (plus blanks); blank-only runs keep the state.
    let e = r.text.length;
    while (e > 0 && (r.text[e - 1] === " " || r.text[e - 1] === "\t")) e--;
    if (e > 0) atLineStart = r.text[e - 1] === "\n";
  }
  chunks.push(cur);
  return chunks;
}

const plain = (runs: Run[]): string => runs.map((r) => r.text).join("");

function keyTable(block: Extract<Block, { kind: "table" }>): SectionTable {
  const widest = block.rows.reduce((n, r) => Math.max(n, r.length), 0);
  const header: string[] = [];
  const seen = new Map<string, number>();
  const rawHeader = block.header ? block.rows[0] : Array.from({ length: widest }, (_, i) => `col${i + 1}`);
  for (const h of rawHeader) {
    const base = h.trim() || `col${header.length + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    header.push(n === 1 ? base : `${base}#${n}`);
  }
  const data = block.header ? block.rows.slice(1) : block.rows;
  const rows = data.map((cells) => {
    // Null-prototype rows: a header named `__proto__` or `constructor` is just a key.
    const o: Record<string, string> = Object.create(null);
    cells.forEach((c, i) => {
      o[i < header.length ? header[i] : `col${i + 1}`] = c;
    });
    return o;
  });
  return { header, rows };
}

const TAG_RE = /\[(V|I|author)(?:\s{0,2},\s{0,2}([^\]\n]{0,80}))?\]/g;
const UNKNOWN_RE = /owners?\s{1,3}to\s{1,3}confirm(?:\s{0,3}:\s{0,3}([^.;,()[\]\n]{1,60}))?/gi;

function findTags(text: string): SectionTag[] {
  const tags: SectionTag[] = [];
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(text)) !== null && tags.length < MAX_TAGS_PER_SECTION) {
    tags.push({
      tag: m[1] as SectionTag["tag"],
      ...(m[2]?.trim() ? { detail: m[2].trim().replace(/`/g, "") } : {}),
    });
  }
  return tags;
}

export function findUnknowns(text: string, section: number | null): UnknownItem[] {
  const out: UnknownItem[] = [];
  const seen = new Set<string>();
  UNKNOWN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = UNKNOWN_RE.exec(text)) !== null && out.length < MAX_UNKNOWNS) {
    const owner = m[1]?.trim() || null;
    const lo = Math.max(0, m.index - 220);
    const lookback = text.slice(lo, m.index);
    // The clause starts after the last sentence/clause boundary before the match.
    // (". " and "; " are two characters wide, a line break one.)
    // A boundary that is absent (-1) must not move the start: only found ones count.
    const after = (i: number, width: number) => (i >= 0 ? i + width : 0);
    const start = Math.max(
      after(lookback.lastIndexOf(". "), 2),
      after(lookback.lastIndexOf("; "), 2),
      after(lookback.lastIndexOf("\n"), 1),
    );
    let from = start;
    // No boundary inside the look-back window: the cut may land inside a word, so skip to the next blank.
    if (start === 0 && lo > 0) {
      const sp = lookback.indexOf(" ");
      from = sp >= 0 ? sp + 1 : 0;
    }
    let clause = cleanText(lookback.slice(from) + m[0]).trim();
    if (clause.length > 200) {
      // Keep the last 200 characters, starting at a word boundary.
      clause = clause.slice(clause.length - 200);
      const sp = clause.indexOf(" ");
      if (sp > 0 && sp < 40) clause = clause.slice(sp + 1);
    }
    const key = `${clause}|${owner}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: clause, owner, section });
  }
  return out;
}

interface Draft {
  number: number;
  title: string;
  pieces: string[];
  chars: number;
  tables: SectionTable[];
  truncated: boolean;
}

function addPiece(d: Draft, text: string): void {
  if (d.chars >= MAX_SECTION_CHARS) {
    if (text.trim()) d.truncated = true;
    return;
  }
  const t = text.length > MAX_SECTION_CHARS - d.chars ? text.slice(0, MAX_SECTION_CHARS - d.chars) : text;
  if (t.length < text.length) d.truncated = true;
  d.pieces.push(t);
  d.chars += t.length + 1;
}

function addRuns(d: Draft, runs: Run[], prefix = ""): void {
  const t = plain(runs).replace(/^\s+/, "");
  if (!t.trim() && !prefix) return;
  addPiece(d, prefix + t);
}

export interface SplitResult {
  /** Plain text of each block before the first section (the header lines live here). */
  pre: string[];
  sections: RecordSection[];
  /** Text of the selected JSON block (removed from every section), or null. */
  jsonText: string | null;
  /** More sections than MAX_SECTIONS were present. */
  overflow: boolean;
  /** A section was cut at MAX_SECTION_CHARS. */
  truncated: boolean;
}

/** A JSON-looking block: starts with `{` (it may be truncated or malformed; that is reported later). */
function isJsonish(t: string): boolean {
  return t.trimStart().startsWith("{");
}

export function splitSections(input: Block[]): SplitResult {
  // 1) Pick the JSON block: the last `{...}` code block (or paragraph) that has a "marker" key,
  //    else the last `{...}` code block. It is excluded from the readable text.
  let jsonIdx = -1;
  let fallbackIdx = -1;
  input.forEach((b, i) => {
    const t = b.kind === "code" ? b.text : b.kind === "paragraph" ? plain(b.runs) : null;
    if (t === null || !isJsonish(t)) return;
    // A paragraph only counts when it carries the marker key (prose can start with "{" too).
    if (/"marker"\s{0,4}:/.test(t)) jsonIdx = i;
    else if (b.kind === "code") fallbackIdx = i;
  });
  if (jsonIdx < 0) jsonIdx = fallbackIdx;
  let jsonText: string | null = null;
  if (jsonIdx >= 0) {
    const b = input[jsonIdx];
    jsonText = b.kind === "code" ? b.text : b.kind === "paragraph" ? plain(b.runs) : null;
  }

  const pre: string[] = [];
  const drafts: Draft[] = [];
  let cur: Draft | null = null;
  let curNumber = 0;
  let overflow = false;
  // A bold "N title:" inside a section (e.g. "**2 blockers:** none") is not a new section unless
  // its number moves forward or its title names a known section.
  const accept = makeAccept(() => curNumber);
  let preChars = 0;

  for (let bi = 0; bi < input.length; bi++) {
    if (bi === jsonIdx) continue;
    const b = input[bi];
    if (b.kind === "paragraph" || b.kind === "heading") {
      const chunks = b.kind === "paragraph" ? splitParagraph(b.runs, accept) : [b.runs];
      for (const runs of chunks) {
        const start = matchRunsStart(runs, 0, b.kind === "heading", accept);
        if (start) {
          if (drafts.length >= MAX_SECTIONS) {
            overflow = true;
            cur = null;
            continue;
          }
          cur = { number: start.number, title: start.title, pieces: [], chars: 0, tables: [], truncated: false };
          curNumber = start.number;
          drafts.push(cur);
          addRuns(cur, start.rest);
        } else if (cur) addRuns(cur, runs);
        else {
          const t = plain(runs);
          if (t.trim() && preChars < 8000) {
            pre.push(t);
            preChars += t.length;
          }
        }
      }
    } else if (b.kind === "listItem") {
      const prefix = " ".repeat(Math.min(b.depth, 5) * 2) + (b.ordered ? `${b.index ?? 1}. ` : "- ");
      if (cur) addRuns(cur, b.runs, prefix);
      else if (preChars < 8000) {
        const t = prefix + plain(b.runs);
        pre.push(t);
        preChars += t.length;
      }
    } else if (b.kind === "table") {
      if (cur) {
        cur.tables.push(keyTable(b));
        for (const r of b.rows) addPiece(cur, r.join(" | "));
      } else if (preChars < 8000) for (const r of b.rows.slice(0, 20)) pre.push(r.join(" | "));
    } else if (b.kind === "code") {
      if (cur) addPiece(cur, b.text);
      else if (preChars < 8000) {
        pre.push(b.text.slice(0, 2000));
        preChars += Math.min(2000, b.text.length);
      }
    }
  }

  const sections: RecordSection[] = drafts.map((d) => {
    // One linear pass: blanks collapsed, line-break runs squeezed, words capped at 200.
    const text = cleanText(d.pieces.join("\n"), 1, true).trim();
    return {
      number: d.number,
      title: d.title,
      canonical: resolveCanonical(d.number, d.title),
      text,
      tables: d.tables,
      tags: findTags(text),
      unknowns: findUnknowns(text, d.number),
    };
  });

  return { pre, sections, jsonText, overflow, truncated: drafts.some((d) => d.truncated) };
}

/**
 * Find the section that holds `canon`: by number when its title does not contradict, else by
 * title (`canonical` already encodes that rule). Returns the first one (duplicates are reported
 * by the caller).
 */
export function findSection(sections: RecordSection[], canon: CanonicalSection): RecordSection | undefined {
  return sections.find((s) => s.canonical === canon);
}
