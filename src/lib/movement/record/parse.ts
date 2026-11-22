/**
 * DEPLOYMENT-RECORD parser: Jira comment -> ParsedRecord (or null when it is not a record).
 *
 * Pipeline: detect (first text only) -> blocks (adf.ts) -> header -> sections (sections.ts)
 * -> JSON block (lenient, whitelisted) -> facts (facts.ts) -> warnings. Pure and synchronous;
 * never throws.
 */
import { blocksToText, bodyHeadText, bodyToBlocks, markdownToBlocks } from "./adf";
import { applyDialect, dialectStatus, looksDialect, normalizeDialect, parseDialect } from "./dialect";
import { extractFacts, extractStatus } from "./facts";
import { findSection, findUnknowns, splitSections, titleMismatch } from "./sections";
import type { Block, Cover, ParsedRecord, RecordComment, RecordFacts, RecordMarker, RecordSection, RecordWarning, Supersedes, UnknownItem } from "./types";
import { asObject, asString, capStr, cleanText, NOT_REPO, normalizeRepo, refsIn } from "./util";

// A quoted reply ("> DEPLOYMENT-RECORD ...") is not a record, so `>` is not allowed in front.
const MARKER_START = /^[\s*_#`~-]{0,8}DEPLOYMENT-RECORD\b/i;
const MAX_JSON_CHARS = 64_000;
const MAX_PREAMBLE = 2000;

/**
 * Cheap detection. Reads only the first ~300 characters of the body (the first text nodes of an
 * ADF document), so a huge non-record comment is rejected without converting the rest.
 */
export function looksLikeRecord(body: unknown): boolean {
  try {
    return MARKER_START.test(bodyHeadText(body));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const TZ = "(Z|UTC|GMT|[+-]\\d{2}:?\\d{2})?";
const TIME = "(?:[T ](\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?";
const TIME_AT = " ?(?:at )?(?:(\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?";
const RE_ISO = new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})${TIME} ?${TZ}$`, "i");
const RE_DMY = new RegExp(`^(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4})${TIME} ?${TZ}$`, "i");
const RE_D_MON = new RegExp(`^(\\d{1,2}) ([A-Za-z]{3,9}),? (\\d{4})${TIME_AT} ?${TZ}$`, "i");
const RE_MON_D = new RegExp(`^([A-Za-z]{3,9}) (\\d{1,2}),? (\\d{4})${TIME_AT} ?${TZ}$`, "i");

function tzOffsetMinutes(tz: string | undefined): number {
  if (!tz || /^(z|utc|gmt)$/i.test(tz)) return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

function build(y: number, mo: number, d: number, h: number, mi: number, s: number, tz?: string): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s) - tzOffsetMinutes(tz) * 60_000;
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return null;
  // Reject overflow like 31 Feb (Date.UTC would roll over to March).
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1) return null;
  return dt.toISOString();
}

/**
 * Header dates: `2026-11-19 11:30`, `2026-11-19T11:30:00Z`, `19/11/2026 11:30`, `19-11-2026`,
 * `19 Nov 2026 11:30 UTC`, `Nov 19, 2026 11:30`. No zone = UTC (the JSON marker's `utc` field
 * carries the same instant). Day-first for the slash/dash formats. null when unparseable.
 */
export function parseRecordDate(raw: string): string | null {
  if (raw.length > 60) return null;
  const s = raw.trim().replace(/\s+/g, " ");
  let m = RE_ISO.exec(s);
  if (m) return build(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), m[7]);
  m = RE_DMY.exec(s);
  if (m) return build(+m[3], +m[2], +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), m[7]);
  m = RE_D_MON.exec(s);
  if (m) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    return mo ? build(+m[3], mo, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), m[7]) : null;
  }
  m = RE_MON_D.exec(s);
  if (m) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    return mo ? build(+m[3], mo, +m[2], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), m[7]) : null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------------------------

/**
 * `supersedes:` value: a comma/"and" list of `v2`, comment ids (4+ digits) and `repo#pr`
 * mentions. `none` gives null. A `repo#pr` is informational and never taken for a comment id.
 */
export function parseSupersedes(raw: string | null): Supersedes | null {
  if (!raw) return null;
  const s = raw.trim().slice(0, 300);
  if (!s || /^(none|n\/a|-|no|null)\b/i.test(s)) return null;
  const out: Supersedes = { raw: s, version: null, commentId: null, versions: [], commentIds: [], prs: [] };
  // "81643, 81700 and 81701", "81643 81700", "v1, v2", "channelkart #1184": a list of any of these.
  const list = s.replace(/([\w.-])\s{1,3}#(\d)/g, "$1#$2");
  for (const tok of list.split(/[\s,;]+|\band\b/i).slice(0, 40)) {
    const t = tok.trim().replace(/^[([]+|[)\].]+$/g, "");
    if (!t) continue;
    let m: RegExpExecArray | null;
    if ((m = /^v(\d{1,4})$/i.exec(t))) out.versions.push(parseInt(m[1], 10));
    else if ((m = /^#?(\d{4,12})$/.exec(t))) out.commentIds.push(m[1]);
    else if ((m = /^([\w./-]{1,100})#(\d{1,6})$/.exec(t))) out.prs.push(`${normalizeRepo(m[1])}#${m[2]}`);
  }
  out.version = out.versions[0] ?? null;
  out.commentId = out.commentIds[0] ?? null;
  return out;
}

interface HeaderResult {
  marker: RecordMarker;
  /** A line containing DEPLOYMENT-RECORD was found. */
  found: boolean;
  preamble: string;
}

/** `owner/repo#12`, `repo#12`, `repo PR #12`, `repo PR 12`, `owner/repo/pull/12`, github pull URLs. */
function parseRepoPr(part: string): { repo: string | null; pr: number } | null {
  const p = part.trim();
  let m = /^(?:https?:\/\/github\.com\/)?(?:[\w.-]{1,100}\/)?([\w.-]{1,100})\/pull\/(\d{1,6})\/?$/i.exec(p);
  if (m) return { repo: validRepo(m[1]), pr: parseInt(m[2], 10) };
  m = /^([\w./:-]{1,200}?)\s{1,3}(?:PR|pull)\s{0,2}#?\s{0,2}(\d{1,6})$/i.exec(p);
  if (m) return { repo: validRepo(m[1]), pr: parseInt(m[2], 10) };
  m = /^([\w./:-]{1,200}?)\s{0,3}#\s{0,3}(\d{1,6})$/.exec(p);
  if (m) return { repo: validRepo(m[1]), pr: parseInt(m[2], 10) };
  return null;
}

function validRepo(raw: string): string | null {
  const r = normalizeRepo(raw);
  return r && !NOT_REPO.has(r) && /^[a-z0-9][\w.-]*$/.test(r) ? r : null;
}

function scanLooseHeader(line: string, marker: RecordMarker): void {
  let m: RegExpExecArray | null;
  if (marker.version === null && (m = /\bv(\d{1,4})\b/i.exec(line))) marker.version = parseInt(m[1], 10);
  if (marker.key === null && (m = /\b([A-Z][A-Z0-9]{1,10}-\d{1,8})\b/.exec(line))) marker.key = m[1];
  if (marker.pr === null) {
    const re = /([\w./:-]{1,100})\s{0,3}#\s{0,3}(\d{1,6})\b/g;
    while ((m = re.exec(line)) !== null) {
      const rp = parseRepoPr(`${m[1]}#${m[2]}`);
      if (rp) {
        marker.pr = rp.pr;
        marker.repo = rp.repo;
        break;
      }
    }
  }
  if (marker.at === null && (m = /\b(\d{4}-\d{1,2}-\d{1,2}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?)?(?: ?(?:Z|UTC))?)/.exec(line))) {
    const iso = parseRecordDate(m[1]);
    if (iso) {
      marker.at = iso;
      marker.atRaw = m[1];
    }
  }
}

function parseHeader(pre: string[], warnings: RecordWarning[]): HeaderResult {
  const lines = pre.join("\n").split("\n");
  const hi = lines.findIndex((l) => /DEPLOYMENT-RECORD/i.test(l));
  const marker: RecordMarker = {
    version: null,
    key: null,
    repo: null,
    pr: null,
    at: null,
    atRaw: null,
    agent: null,
    supersedes: null,
    scope: "pr",
  };
  const used = new Set<number>();
  if (hi >= 0) {
    used.add(hi);
    const parts = lines[hi].slice(0, 1000).split("|").map((p) => p.trim());
    const v = /DEPLOYMENT-RECORD\s{0,3}:?\s{0,3}(?:v(\d{1,4}))?/i.exec(parts[0]);
    if (v?.[1]) marker.version = parseInt(v[1], 10);
    const agent: string[] = [];
    for (let pi = 1; pi < parts.length; pi++) {
      const part = parts[pi];
      if (!part) continue;
      let m: RegExpExecArray | null;
      let rp: ReturnType<typeof parseRepoPr> = null;
      if (marker.version === null && (m = /^v(\d{1,4})$/i.exec(part))) marker.version = parseInt(m[1], 10);
      else if (marker.key === null && (m = /^([A-Z][A-Z0-9]{1,10}-\d{1,8})$/.exec(part))) marker.key = m[1];
      else if (marker.pr === null && (rp = parseRepoPr(part) ?? parseRepoPr(part.replace(/\s{0,3}\([^()]{0,40}\)\s{0,3}$/, "")))) {
        marker.pr = rp.pr;
        marker.repo = rp.repo; // null for an invalid repo word: the JSON marker may fill it
      } else if (pi === 2 && marker.pr === null && marker.key !== null && !parseRecordDate(part)) {
        // The third field is free text, not repo#pr ("union of 2 merged PRs"): a union record.
        marker.target = capStr(part, 200);
        marker.scope = "union";
      } else if (marker.at === null && marker.atRaw === null && parseRecordDate(part)) {
        marker.at = parseRecordDate(part);
        marker.atRaw = part;
      } else agent.push(part);
    }
    // An unparseable date lands in `agent`; spot it so it is reported, not lost.
    if (marker.at === null && agent.length > 1) {
      const maybeDate = agent.find((a) => /\d{1,4}[-/. ]\d{1,2}[-/. ]\d{1,4}|\d{1,2}:\d{2}/.test(a));
      if (maybeDate) {
        marker.atRaw = capStr(maybeDate, 60);
        agent.splice(agent.indexOf(maybeDate), 1);
        warnings.push({ code: "date_unparseable", path: "header", message: `Header date "${capStr(maybeDate, 40)}" is not a known format` });
      }
    }
    if (agent.length) marker.agent = capStr(agent.join(" | "), 200);
    // No pipes at all ("DEPLOYMENT-RECORD v1 CAV-1 repo#2 2026-11-19 10:00 bot"): pick the
    // pieces out of the line by their shape.
    if (parts.length === 1) scanLooseHeader(lines[hi].slice(0, 400), marker);
  }
  // supersedes: on the second line, or anywhere in the pre-section text.
  const si = lines.findIndex((l, i) => i !== hi && /^\s{0,4}supersedes\s{0,3}:/i.test(l));
  if (si >= 0) {
    used.add(si);
    marker.supersedes = parseSupersedes(lines[si].replace(/^\s{0,4}supersedes\s{0,3}:\s{0,3}/i, ""));
    if (marker.supersedes) {
      const all = marker.supersedes.raw
        .replace(/([\w.-])\s{1,3}#(\d)/g, "$1#$2")
        .split(/[\s,;]+|\band\b/i)
        .map((t) => t.trim().replace(/^[([]+|[)\].]+$/g, ""))
        .filter((t) => /^(?:v\d{1,4}|#?\d{4,12})$/i.test(t))
        .map((t) => t.replace(/^#/, ""));
      marker.supersedesAll = all.slice(0, 40);
    }
  }
  // "union of 17 merged PRs": the number the header declares.
  if (marker.target) {
    const dm = /\bunion of (\d{1,4})\b/i.exec(marker.target);
    if (dm) marker.declaredPrs = parseInt(dm[1], 10);
  }
  const preamble = capStr(
    lines
      .filter((_l, i) => !used.has(i))
      .join("\n")
      .trim(),
    MAX_PREAMBLE,
  );
  return { marker, found: hi >= 0, preamble };
}

// ---------------------------------------------------------------------------------------------
// JSON block
// ---------------------------------------------------------------------------------------------

function parseJsonLenient(text: string): { value: Record<string, unknown> | null; error: string | null } {
  if (text.length > MAX_JSON_CHARS) return { value: null, error: "JSON block too large" };
  const attempt = (s: string) => {
    const v = JSON.parse(s) as unknown;
    const o = asObject(v);
    if (!o) throw new Error("JSON block is not an object");
    return o;
  };
  try {
    return { value: attempt(text), error: null };
  } catch (first) {
    try {
      const a = text.indexOf("{");
      const b = text.lastIndexOf("}");
      const repaired = text
        .slice(a < 0 ? 0 : a, b < 0 ? undefined : b + 1)
        .replace(/[“”]/g, '"')
        .replace(/,\s{0,64}([}\]])/g, "$1");
      return { value: attempt(repaired), error: null };
    } catch {
      return { value: null, error: capStr(first instanceof Error ? first.message : String(first), 200) };
    }
  }
}

/** Only these top-level keys of the JSON block are kept (everything the parser reads). */
const JSON_KEYS = ["marker", "status", "branches", "prodBranch", "deploy", "restart", "order", "configs", "risks", "app"];
const JSON_MAX_DEPTH = 6;
const JSON_MAX_ITEMS = 100;
const JSON_MAX_KEYS = 40;
const JSON_MAX_STR = 500;

/**
 * A depth/size-capped, whitelisted, null-prototype copy of the JSON block: whatever the original
 * looked like, the result is small and safe to JSON.stringify / structuredClone.
 */
function slimJson(v: unknown, depth: number): unknown {
  if (typeof v === "string") return v.length > JSON_MAX_STR ? v.slice(0, JSON_MAX_STR) : v;
  if (typeof v === "number" || typeof v === "boolean" || v === null) return v;
  if (depth >= JSON_MAX_DEPTH) return null;
  if (Array.isArray(v)) return v.slice(0, JSON_MAX_ITEMS).map((x) => slimJson(x, depth + 1));
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = Object.create(null);
    let n = 0;
    for (const k of Object.keys(v)) {
      if (n++ >= JSON_MAX_KEYS) break;
      o[k.slice(0, 80)] = slimJson((v as Record<string, unknown>)[k], depth + 1);
    }
    return o;
  }
  return null;
}

function whitelistJson(json: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  for (const k of JSON_KEYS) if (Object.prototype.hasOwnProperty.call(json, k)) out[k] = slimJson(json[k], 1);
  return out;
}

/** A longer name that ends with `-<shorter>` is the same repo written two ways. */
function sameRepoSuffix(a: string, b: string): boolean {
  return a.endsWith("-" + b) || b.endsWith("-" + a);
}

function mergeMarkerFromJson(marker: RecordMarker, json: Record<string, unknown>, warnings: RecordWarning[]): void {
  const jm = asObject(json.marker);
  if (!jm) return;
  const dis = (field: string, a: string, b: string) =>
    warnings.push({
      code: "json_disagrees",
      path: `json:marker.${field}`,
      message: `JSON marker ${field} is "${capStr(b, 60)}" but the header says "${capStr(a, 60)}"; the header is used`,
    });
  const jv = asString(jm.version);
  if (jv) {
    const n = parseInt(jv.replace(/^v/i, ""), 10);
    if (!Number.isNaN(n)) {
      if (marker.version === null) marker.version = n;
      else if (marker.version !== n) dis("version", String(marker.version), String(n));
    }
  }
  const jk = asString(jm.key);
  if (jk) {
    if (marker.key === null) marker.key = jk;
    else if (marker.key !== jk) dis("key", marker.key, jk);
  }
  const jr = asString(jm.repo);
  if (jr) {
    const nr = validRepo(jr);
    if (nr) {
      if (marker.repo === null) marker.repo = nr;
      else if (marker.repo !== nr) {
        // "flutter" vs "channelkart-flutter": same repo; keep the full name, no warning.
        if (sameRepoSuffix(marker.repo, nr)) marker.repo = marker.repo.length >= nr.length ? marker.repo : nr;
        else dis("repo", marker.repo, nr);
      }
    }
  }
  const jp = asString(jm.pr);
  if (jp && /^\d{1,6}$/.test(jp)) {
    const n = parseInt(jp, 10);
    if (marker.pr === null) marker.pr = n;
    else if (marker.pr !== n) dis("pr", String(marker.pr), String(n));
  }
  const ju = asString(jm.utc) ?? asString(jm.at);
  if (ju) {
    const iso = parseRecordDate(ju);
    if (iso) {
      if (marker.at === null) marker.at = iso;
      else if (Math.abs(Date.parse(marker.at) - Date.parse(iso)) > 60_000) dis("utc", marker.at, iso);
    }
  }
  const ja = asString(jm.agent);
  if (ja && marker.agent === null) marker.agent = capStr(ja, 200);
  if (marker.supersedes === null && jm.supersedes !== null && jm.supersedes !== undefined) {
    marker.supersedes = parseSupersedes(asString(jm.supersedes));
  }
}

// ---------------------------------------------------------------------------------------------

const ALL_NUMBERS = Array.from({ length: 14 }, (_, i) => i + 1);

/**
 * Parse one Jira comment. Returns null when the comment is not a DEPLOYMENT-RECORD (decided on
 * the first text only). Everything else yields a record, however incomplete: a comment holding
 * only the marker line gives a record with no sections and warnings.
 */
/**
 * When the whole record sits in a code block (or any code block starts with the marker), read the
 * block's text as ordinary markdown-ish text. The raw text is returned too: a free-form record
 * depends on its monospaced column layout.
 */
function unwrapCodeRecord(blocks: Block[]): { blocks: Block[]; text: string; truncated: boolean } | null {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if ((b.kind === "paragraph" || b.kind === "heading") && /DEPLOYMENT-RECORD/i.test(b.runs.map((r) => r.text).join("").slice(0, 400))) return null;
    if (b.kind === "code" && MARKER_START.test(b.text.slice(0, 40))) {
      const md = markdownToBlocks(b.text);
      return { blocks: [...blocks.slice(0, i), ...md.blocks, ...blocks.slice(i + 1)], text: b.text, truncated: md.truncated };
    }
  }
  return null;
}

/** `**8 Configs:**` style headings in the text: a numbered-section record, not a free-form one. */
const BOLD_SECTION_LINE = /^ {0,4}\*\*\d{1,2}[.)]? [^*\n]{1,80}\*\*/m;

function withoutDuplicates(items: UnknownItem[]): UnknownItem[] {
  const seen = new Set<string>();
  return items.filter((u) => {
    const k = `${u.text}|${u.owner}|${u.row ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** "union of 17 merged PRs" against the PRs actually listed (info only). */
function warnCountMismatch(marker: RecordMarker, listed: number, warnings: RecordWarning[]): void {
  if (marker.scope !== "union" || marker.declaredPrs === undefined || marker.declaredPrs === listed) return;
  warnings.push({
    code: "covers_count_mismatch",
    path: "header",
    count: listed,
    message: `The header says "union of ${marker.declaredPrs} merged PRs" but ${listed} merged PR(s) are listed`,
  });
}

/** `covers` for records parsed from numbered sections: the own PR, or the PRs a union record names. */
function coversFromSections(marker: RecordMarker, sections: RecordSection[], facts: RecordFacts): Cover[] {
  if (marker.scope !== "union") return marker.repo && marker.pr !== null ? [{ repo: marker.repo, pr: marker.pr }] : [];
  const out: Cover[] = [];
  const add = (repo: string, pr: number, state?: Cover["state"]) => {
    if (out.length < 40 && !out.some((c) => c.repo === repo && c.pr === pr)) out.push({ repo, pr, ...(state ? { state } : {}) });
  };
  const header = findSection(sections, "header");
  if (header) for (const r of refsIn(header.text, 20)) add(r.repo, r.pr);
  for (const sib of facts.siblings ?? []) add(sib.repo, sib.pr, sib.state);
  return out;
}

/**
 * Parse one Jira comment. Returns null when the comment is not a DEPLOYMENT-RECORD (decided on
 * the first text only). Everything else yields a record, however incomplete: a comment holding
 * only the marker line gives a record with no sections and warnings.
 *
 * Three shapes are read: numbered `**N Title:**` sections (+ JSON block); a free-form "dialect"
 * of ALL-CAPS label lines and numbered release rows (see dialect.ts), often inside one code
 * block; and a header-only comment.
 */
export function parseDeploymentRecord(comment: RecordComment): ParsedRecord | null {
  if (!looksLikeRecord(comment.body)) return null;
  const warnings: RecordWarning[] = [];
  const base = {
    comment: {
      id: String(comment.id),
      created: comment.created ?? null,
      updated: comment.updated ?? null,
    },
  };
  try {
    const read = bodyToBlocks(comment.body);
    let blocks = read.blocks;
    const truncated = read.truncated;
    // A record inside a code block is also run through the markdown reader (20 KB per paragraph); that is only the block view, a dialect record
    // is parsed from the code text itself, so the markdown cut counts only when the numbered-section reader is used.
    let unwrapTruncated = false;
    let codeText: string | null = null;
    const unwrapped = unwrapCodeRecord(blocks);
    if (unwrapped) {
      blocks = unwrapped.blocks;
      codeText = unwrapped.text;
      unwrapTruncated = unwrapped.truncated;
      warnings.push({ code: "record_in_code_block", message: "The record was inside a code block and was read as ordinary text" });
    }

    // Free-form text: the code block itself, the markdown source, or the blocks flattened to lines.
    const plainSource = typeof comment.body === "string" && !comment.body.trimStart().startsWith("{");
    const source = codeText ?? (plainSource ? (comment.body as string) : blocksToText(blocks));
    const norm = normalizeDialect(source);
    const dialectOn = looksDialect(norm.text) && !BOLD_SECTION_LINE.test(norm.text);

    const split = dialectOn
      ? {
          pre: [norm.text.split("\n", 3).filter((l) => /DEPLOYMENT-RECORD|^\s{0,4}supersedes\s{0,3}:/i.test(l)).join("\n")],
          sections: [] as RecordSection[],
          jsonText: null as string | null,
          overflow: false,
          truncated: norm.truncated,
        }
      : splitSections(blocks);
    const wasTruncated = truncated || (dialectOn ? false : unwrapTruncated) || split.overflow || split.truncated;
    if (wasTruncated) {
      warnings.push({ code: "truncated", message: "The comment exceeded a safety limit (64 KB text, 20 KB per section/paragraph, 200 chars per word); the rest was cut" });
    }
    const header = parseHeader(split.pre, warnings);
    const marker = header.marker;

    let json: Record<string, unknown> | null = null;
    if (split.jsonText === null) {
      if (!dialectOn) warnings.push({ code: "json_missing", path: "json", message: "No JSON block found" });
    } else {
      const r = parseJsonLenient(split.jsonText);
      if (r.error) {
        warnings.push({ code: "json_malformed", path: "json", message: `JSON block is not valid JSON: ${r.error}` });
      } else if (r.value) {
        json = whitelistJson(r.value);
        mergeMarkerFromJson(marker, json, warnings);
      }
    }
    // A union record has no single repo/pr by design.
    const missingParts = (["key", "repo", "pr"] as const).filter((k) => marker[k] === null && !(marker.scope === "union" && k !== "key"));
    if (missingParts.length) {
      warnings.push({
        code: "header_mismatch",
        path: "header",
        message: header.found ? `Header lacks ${missingParts.join(", ")}` : "No DEPLOYMENT-RECORD header line",
      });
    }

    const { sections } = split;
    const seenNum = new Set<number>();
    const seenCanon = new Set<string>();
    for (const s of sections) {
      if (seenNum.has(s.number) || (s.canonical && seenCanon.has(s.canonical))) {
        warnings.push({
          code: "section_duplicate",
          path: `section:${s.number}`,
          message: `Section "${s.number} ${capStr(s.title, 60)}" appears more than once; the first one is used`,
        });
      }
      seenNum.add(s.number);
      if (s.canonical) seenCanon.add(s.canonical);
      if (titleMismatch(s.number, s.title)) {
        warnings.push({
          code: "section_title_mismatch",
          path: `section:${s.number}`,
          message: `Section ${s.number} is titled "${capStr(s.title, 60)}", which names a different template section`,
        });
      }
    }
    const present = new Set(sections.map((s) => s.number));
    const missing = ALL_NUMBERS.filter((n) => !present.has(n));
    if (missing.length && !dialectOn) {
      // One aggregated warning (a marker-only comment would otherwise carry 14).
      warnings.push({
        code: "section_missing",
        count: missing.length,
        message: `${missing.length} template section(s) missing: ${missing.join(", ")}`,
      });
    }

    if (dialectOn) {
      const d = parseDialect(norm.text);
      const facts: RecordFacts = {};
      const own: Cover[] = marker.scope !== "union" && marker.repo && marker.pr !== null ? [{ repo: marker.repo, pr: marker.pr }] : [];
      const covers = own.length ? own : d.covers;
      applyDialect(facts, d, d.covers.length ? d.covers : covers);
      facts.covers = covers;
      warnCountMismatch(marker, covers.length, warnings);
      const st = dialectStatus(d);
      // "owner to confirm" clauses already reported as a row's unknown are not reported twice.
      const rowUnknowns = d.unknowns.filter((u) => u.row !== undefined);
      const extra = findUnknowns(norm.text, null).filter((u) => !rowUnknowns.some((r) => r.owner === u.owner && r.text.includes(u.text)));
      return {
        ...base,
        marker,
        status: st.status,
        statusText: st.statusText,
        counts: null,
        preamble: "",
        sections: [],
        facts,
        unknowns: withoutDuplicates([...d.unknowns, ...extra]),
        json: null,
        warnings,
        truncated: wasTruncated,
        body: norm.text,
      };
    }

    const hdr = findSection(sections, "header");
    const st = extractStatus(hdr?.text, json, warnings);
    const self = marker.repo && marker.pr !== null ? { repo: marker.repo, pr: marker.pr } : null;
    const facts = extractFacts({ sections, json, key: marker.key, self, warnings });
    const covers = coversFromSections(marker, sections, facts);
    if (covers.length) facts.covers = covers;
    if (marker.scope === "union") warnCountMismatch(marker, covers.length, warnings);

    // The configs table now lives in facts.configs (every column kept): hold the data once.
    const cfgSection = findSection(sections, "configs");
    if (cfgSection && cfgSection.tables.length && facts.configs?.some((c) => c.source !== "json")) cfgSection.tables = [];

    return {
      ...base,
      marker,
      status: st.status,
      statusText: st.statusText,
      counts: st.counts,
      preamble: cleanText(header.preamble, 1, true),
      sections,
      facts,
      unknowns: sections.flatMap((s) => s.unknowns),
      json,
      warnings,
      truncated: wasTruncated,
    };
  } catch (e) {
    // Last resort: the comment is a record (marker seen) but something unexpected broke.
    warnings.push({
      code: "extractor_failed",
      message: `Record could not be parsed: ${capStr(e instanceof Error ? e.message : String(e), 200)}`,
    });
    return {
      ...base,
      marker: { version: null, key: null, repo: null, pr: null, at: null, atRaw: null, agent: null, supersedes: null, scope: "pr" },
      status: null,
      statusText: null,
      counts: null,
      preamble: "",
      sections: [],
      facts: {},
      unknowns: [],
      json: null,
      warnings,
      truncated: false,
    };
  }
}
