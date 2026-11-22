/**
 * Best-effort fact extractors. Each extractor is independent and wrapped, so a failure in one
 * only drops that fact (with a warning) and never breaks the record. Facts come from the
 * readable section text first; the JSON block fills what the text lacks; when both state a value
 * and disagree the readable text wins and a `json_disagrees` warning is raised.
 *
 * All input text has been through `cleanText` (single blanks, words <= 200 chars) and a size cap;
 * every regex below uses bounded quantifiers, so no extractor can be driven into backtracking.
 * Fact strings are capped (~500 chars); long text stays in `sections[].text`.
 */
import type {
  ConfigRow,
  OrderEdge,
  OrderStep,
  PrRef,
  RecordFacts,
  RecordSection,
  RecordWarning,
  RiskItem,
  RoleCase,
  ServiceFact,
  Severity,
  Tri,
} from "./types";
import {
  agree,
  asArray,
  asObject,
  asString,
  capStr,
  NOT_REPO,
  normalizeRepo,
  outsideParens,
  refsIn,
  refsWithPos,
  resolveAlias,
  sentences,
  splitOutsideParens,
  stripTags,
  trimDot,
  trimEndChars,
  untilSentence,
} from "./util";
import { findSection } from "./sections";

const CAP = 500;

export interface FactsCtx {
  sections: RecordSection[];
  /** Sanitised, whitelisted JSON subset (see parse.ts), or null. */
  json: Record<string, unknown> | null;
  /** Jira key from the marker (for jiraIdInBranch). */
  key: string | null;
  /** The record's own PR (`repo`, `pr`), for edges such as "after X" => X before this PR. */
  self: { repo: string; pr: number } | null;
  warnings: RecordWarning[];
}

type Extractor = (ctx: FactsCtx) => Partial<RecordFacts> | undefined;

function disagree(ctx: FactsCtx, path: string, text: string, json: string): void {
  ctx.warnings.push({
    code: "json_disagrees",
    path,
    message: `JSON says "${capStr(json, 80)}" but the readable section says "${capStr(text, 80)}"; the readable section is used`,
  });
}

// --- status (also used by parse.ts) -----------------------------------------------------------

export interface StatusInfo {
  status: "READY" | "PARTIAL" | "BLOCKED" | null;
  statusText: string | null;
  counts: { blocking?: number; shouldFix?: number; nitpick?: number } | null;
}

const STATUS_WITH_LABEL = /\bStatus\W{0,3}(NOT READY|READY|PARTIAL|BLOCKED)\b([^(.\n]{0,60})(?:\(([^)\n]{0,120})\))?/i;
// Without the word "Status" only the upper-case words count (prose "ready" is not a status).
const STATUS_BARE = /\b(NOT READY|BLOCKED|PARTIAL|READY)\b([^(.\n]{0,60})(?:\(([^)\n]{0,120})\))?/;

export function extractStatus(
  text: string | undefined,
  json: Record<string, unknown> | null,
  warnings: RecordWarning[],
): StatusInfo {
  let status: StatusInfo["status"] = null;
  let statusText: string | null = null;
  let counts: StatusInfo["counts"] = null;
  if (text) {
    const m = STATUS_WITH_LABEL.exec(text) ?? STATUS_BARE.exec(text);
    if (m) {
      const word = m[1].toUpperCase();
      status = word === "NOT READY" ? "BLOCKED" : (word as StatusInfo["status"]);
      statusText = (word + " " + m[2].trim()).trim() + (m[3] ? ` (${m[3].trim()})` : "");
      if (m[3]) {
        const c: NonNullable<StatusInfo["counts"]> = {};
        const re = /(\d{1,4})\s{1,3}(?:open\s{1,3})?(blocking|should-?fix|nit(?:pick)?s?)/gi;
        let cm: RegExpExecArray | null;
        while ((cm = re.exec(m[3])) !== null) {
          const n = parseInt(cm[1], 10);
          const k = cm[2].toLowerCase();
          if (k.startsWith("block")) c.blocking = n;
          else if (k.startsWith("should")) c.shouldFix = n;
          else c.nitpick = n;
        }
        if (Object.keys(c).length) counts = c;
      }
    }
  }
  const js = asString(json?.status)?.toUpperCase();
  if (js === "READY" || js === "PARTIAL" || js === "BLOCKED") {
    if (!status) status = js;
    else if (status !== js) {
      warnings.push({
        code: "json_disagrees",
        path: "json:status",
        message: `JSON status ${js} differs from the readable status ${status}; the readable one is used`,
      });
    }
  }
  return { status, statusText, counts };
}

// --- header (1) -------------------------------------------------------------------------------

const exHeader: Extractor = (ctx) => {
  const s = findSection(ctx.sections, "header");
  if (!s) return undefined;
  const t = s.text;
  const out: Partial<RecordFacts> = {};
  const si = t.search(/\bStatus\b/i);
  const rawSummary = si >= 0 ? t.slice(0, si) : (t.split(". ")[0] ?? "");
  const summary = trimDot(stripTags(rawSummary.slice(0, 600)));
  if (summary) out.summary = capStr(summary, 300);
  const hr = /Head reviewed:\s{0,2}([0-9a-f]{7,40})/i.exec(t);
  if (hr) out.headReviewed = hr[1];
  const mv = /since\s{1,3}moved\s{1,3}to\s{1,3}([0-9a-f]{7,40})/i.exec(t);
  if (mv) {
    out.headMovedTo = mv[1];
    if (/not yet reviewed/i.test(t)) out.headMovedUnreviewed = true;
  }
  const url = /https?:\/\/[^\s)\]>]{1,300}/.exec(t);
  if (url) out.reviewUrl = trimEndChars(url[0], ".,;");
  return out;
};

// --- branches (2) -----------------------------------------------------------------------------

function parseState(s: string): "open" | "merged" | "closed" | "draft" | undefined {
  const v = s.toLowerCase();
  return v === "open" || v === "merged" || v === "closed" || v === "draft" ? v : undefined;
}

const STATE_RE = /^\s{0,2}\((all |both )?(open|merged|closed|draft)\)/i;

/**
 * Siblings: each ref takes its own "(state)"; a group state "(all open)" / "(both open)" applies
 * to the refs written since the previous state. The segment ends at the first ". " + capital.
 */
function parseSiblings(seg: string): PrRef[] {
  const refs = refsWithPos(seg, 20);
  const out: PrRef[] = [];
  let pending: PrRef[] = [];
  for (const r of refs) {
    const ref: PrRef = { repo: r.repo, pr: r.pr };
    out.push(ref);
    const m = STATE_RE.exec(seg.slice(r.end, r.end + 40));
    if (m) {
      const st = parseState(m[2]);
      if (st) {
        if (m[1]) for (const p of [...pending, ref]) p.state = st;
        else ref.state = st;
      }
      pending = [];
    } else pending.push(ref);
  }
  return out;
}

const REPLACE_REF = /([A-Za-z][\w.-]{0,79})?\s?#(\d{1,6})\b(?:\s{0,2}\((open|merged|closed|draft|superseded)\))?/gi;

function parseReplaces(t: string, selfRepo: string | null): RecordFacts["replaces"] {
  const out: NonNullable<RecordFacts["replaces"]> = [];
  const re = /\bReplaces\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null && out.length < 10) {
    const seg = untilSentence(t, m.index + m[0].length, 200);
    REPLACE_REF.lastIndex = 0;
    let rm: RegExpExecArray | null;
    while ((rm = REPLACE_REF.exec(seg)) !== null && out.length < 10) {
      const written = rm[1] ? normalizeRepo(trimEndChars(rm[1], ".-")) : "";
      const repo = written && !NOT_REPO.has(written) ? written : "";
      const item: { pr: number; state: string | null; repo?: string } = {
        pr: parseInt(rm[2], 10),
        state: rm[3]?.toLowerCase() ?? null,
      };
      if (repo && repo !== selfRepo) item.repo = repo;
      out.push(item);
    }
  }
  return out;
}

const exBranches: Extractor = (ctx) => {
  const s = findSection(ctx.sections, "branches");
  const jb = asObject(ctx.json?.branches);
  const out: Partial<RecordFacts> = {};
  const t = s ? stripTags(s.text) : "";

  if (s) {
    const arrow = /(\S{1,100})\s{0,3}->\s{0,3}(\S{1,100}?)(?=[,;\s]|$)/.exec(t);
    if (arrow) {
      out.branch = trimEndChars(arrow[1].replace(/^[`(]+/, ""), "`,.");
      out.baseBranch = trimEndChars(arrow[2].replace(/^[`(]+/, ""), "`,.");
    }
    const st = /\bPR\s{0,2}#\d{1,6}\s{0,2},\s{0,2}(OPEN|MERGED|CLOSED|DRAFT)\b/i.exec(t) ?? /\b(OPEN|MERGED|CLOSED)\b/.exec(t);
    if (st) out.prState = parseState(st[1]);
    if (/\b(?:not mergeable|unmergeable|CONFLICTING|has conflicts)\b/i.test(t)) out.mergeable = false;
    else if (/\bmergeable\b/i.test(t)) out.mergeable = true;
    const r31 = /Rule 31\s{1,3}(pass|fail)/i.exec(t);
    if (r31) out.rule31 = r31[1].toLowerCase() as "pass" | "fail";
    const au = /PR author\s{1,3}([\w.-]{1,60})/i.exec(t);
    if (au) out.author = trimEndChars(au[1], ".,;-");
    const fc = /first commit\s{1,3}([^)\n]{1,80})\)/i.exec(t);
    if (fc) out.firstCommitBy = fc[1].trim();
    const ap = /Approvers?:\s{0,2}((?:[^.\n]|\.(?!\s|$)){0,200})/i.exec(t);
    if (ap) {
      const v = ap[1].trim();
      out.approvers = /^(none|no one|nobody)\b/i.test(v)
        ? []
        : v
            .split(/,|\band\b/)
            .map((x) => capStr(x.trim(), 80))
            .filter(Boolean)
            .slice(0, 20);
    }
    const mb = /Merged by:\s{0,2}((?:[^.\n]|\.(?!\s|$)){0,200})/i.exec(t);
    if (mb) {
      const v = mb[1].trim();
      out.mergedBy = /^(not merged|none|n\/a)\b/i.test(v) || !v ? null : capStr(v, 80);
    }
    const sib = /Siblings?:\s{0,2}/i.exec(t);
    if (sib) out.siblings = parseSiblings(untilSentence(t, sib.index + sib[0].length, 400));
    const reps = parseReplaces(t, ctx.self?.repo ?? null);
    if (reps && reps.length) out.replaces = reps;
  }

  if (jb) {
    // Fill from JSON what the text did not give; report real disagreements.
    const jBranch = asString(jb.branch);
    const jBase = asString(jb.base);
    const jState = asString(jb.state);
    const jAuthor = asString(jb.author);
    if (jBranch) {
      if (out.branch === undefined) out.branch = jBranch;
      else if (!agree(out.branch, jBranch)) disagree(ctx, "json:branches.branch", out.branch, jBranch);
    }
    if (jBase) {
      if (out.baseBranch === undefined) out.baseBranch = jBase;
      else if (!agree(out.baseBranch, jBase)) disagree(ctx, "json:branches.base", out.baseBranch, jBase);
    }
    if (jState) {
      const js = parseState(jState);
      if (out.prState === undefined) out.prState = js;
      else if (js && js !== out.prState) disagree(ctx, "json:branches.state", out.prState, js);
    }
    if (jAuthor) {
      if (out.author === undefined) out.author = jAuthor;
      else if (!agree(out.author, jAuthor)) disagree(ctx, "json:branches.author", out.author, jAuthor);
    }
    if (Array.isArray(jb.approvers)) {
      const ja = asArray(jb.approvers)
        .map(asString)
        .filter((x): x is string => !!x)
        .slice(0, 20);
      if (out.approvers === undefined) out.approvers = ja;
      else if (ja.map((x) => x.toLowerCase()).sort().join() !== out.approvers.map((x) => x.toLowerCase()).sort().join()) {
        disagree(ctx, "json:branches.approvers", out.approvers.join(", ") || "none", ja.join(", ") || "none");
      }
    }
    if ("mergedBy" in jb) {
      const jm = asString(jb.mergedBy);
      if (out.mergedBy === undefined) out.mergedBy = jm;
      else if ((out.mergedBy ?? null) !== jm && !(out.mergedBy && jm && agree(out.mergedBy, jm))) {
        disagree(ctx, "json:branches.mergedBy", out.mergedBy ?? "not merged", jm ?? "not merged");
      }
    }
    if (Array.isArray(jb.siblings)) {
      const js: PrRef[] = [];
      for (const x of asArray(jb.siblings).slice(0, 20)) {
        const str = asString(x);
        if (str) js.push(...refsIn(str, 1));
      }
      if (out.siblings === undefined) out.siblings = js;
      else {
        const a = out.siblings.map((r) => `${r.repo}#${r.pr}`).sort().join();
        const b = js.map((r) => `${r.repo}#${r.pr}`).sort().join();
        if (a !== b) disagree(ctx, "json:branches.siblings", a, b);
      }
    }
    if (typeof jb.jiraIdInBranch === "boolean") out.jiraIdInBranch = jb.jiraIdInBranch;
  }
  if (out.jiraIdInBranch === undefined && out.branch && ctx.key) {
    out.jiraIdInBranch = out.branch.toUpperCase().includes(ctx.key.toUpperCase());
  }
  return Object.keys(out).length ? out : undefined;
};

// --- prod branch (3) --------------------------------------------------------------------------

const exProdBranch: Extractor = (ctx) => {
  const s = findSection(ctx.sections, "prodBranch");
  const jp = asObject(ctx.json?.prodBranch);
  const jBranch = asString(jp?.branch);
  if (!s && !jBranch) return undefined;
  const t = s ? stripTags(s.text) : "";
  const all: string[] = [];
  const re = /\b(prod[-_][\w.*-]{0,80})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null && all.length < 10) {
    const b = trimEndChars(m[1], ".-");
    if (b.length > 5 && !all.includes(b)) all.push(b);
  }
  let branch: string | null = all[0] ?? null;
  if (branch === null && jBranch) {
    branch = jBranch;
    all.push(jBranch);
  } else if (branch && jBranch && !agree(branch, jBranch)) disagree(ctx, "json:prodBranch.branch", branch, jBranch);
  const pb: NonNullable<RecordFacts["prodBranch"]> = { branch };
  if (branch && branch.includes("*")) pb.isPattern = true;
  if (/prod(?:uction)?\s{1,3}branch[^.:;]{0,60}:\s{0,3}unknown/i.test(t) || (branch === null && /\bunknown\b/i.test(t))) pb.unknown = true;
  return { prodBranch: pb, ...(all.length ? { prodBranches: all } : {}) };
};

// --- deploy / restart (4, 5) ------------------------------------------------------------------

/** A piece that talks about the service rather than naming it (verbs outside parentheses). */
function isStatement(outside: string): boolean {
  return outside.trim().split(/\s+/).length > 6 || /\b(must|needs?|loses|lost|reads?|runs?|is|are|has|have|keeps?)\b/i.test(outside);
}

export function parseServices(text: string): { services: ServiceFact[]; notes: string[]; none: boolean } {
  const t = stripTags(text);
  if (/^\s*none\b/i.test(t)) return { services: [], notes: [], none: true };
  const services: ServiceFact[] = [];
  const notes: string[] = [];
  for (const sentence of sentences(t)) {
    if (/owner to confirm|Downtime required|Bundle SDK build|^Needs\b|^Property changes|:\s{0,2}not touched|^No other service/i.test(sentence)) continue;
    const cleaned = sentence.replace(/^Also\s+/i, "");
    for (const piece of splitOutsideParens(cleaned, /;|\s+and\s+(?=the\s|[A-Z])/)) {
      const p = trimDot(piece.replace(/^the\s+/i, ""));
      if (!p) continue;
      // The filter looks outside the parentheses only: "(new consumer, needs a restart)" is a note.
      const outside = outsideParens(p);
      if (isStatement(outside)) {
        // "auth-service restart loses its in-memory sweep timer": the sentence is about the
        // service named first, so that service is listed (alias resolved later) with the
        // sentence as its note.
        const lead = /^([a-z0-9][\w.-]{1,60})\s{1,3}restarts?\b/i.exec(outside);
        if (lead && services.length < 30) services.push({ name: lead[1], note: capStr(p, 300) });
        else if (notes.length < 10) notes.push(capStr(p, 300));
        continue;
      }
      const open = p.indexOf("(");
      const name = (open >= 0 ? p.slice(0, open) : p).trim();
      const close = open >= 0 ? p.lastIndexOf(")") : -1;
      const note = open >= 0 && close > open ? p.slice(open + 1, close).trim() : "";
      if (!name) continue;
      services.push({ name: capStr(name, 100), ...(note ? { note: capStr(note, 200) } : {}) });
      if (services.length >= 30) break;
    }
  }
  return { services, notes, none: false };
}

function tri(v: string): Tri {
  const x = v.toLowerCase();
  return x === "yes" ? "yes" : x === "no" ? "no" : "unknown";
}

const exDeploy: Extractor = (ctx) => {
  const s = findSection(ctx.sections, "deploy");
  const out: Partial<RecordFacts> = {};
  if (s) {
    const r = parseServices(s.text);
    if (r.none) out.deployNone = true;
    else if (r.services.length) out.deploy = r.services;
    if (r.notes.length) out.deployNotes = r.notes;
    const b = /Bundle SDK build:\s{0,2}(yes|no|unknown)\b/i.exec(s.text);
    if (b) out.bundleSdkBuild = tri(b[1]);
  }
  if (!out.deploy && !out.deployNone) {
    const jd = asArray(ctx.json?.deploy)
      .slice(0, 30)
      .map((x) => asString(asObject(x)?.service) ?? asString(x))
      .filter((x): x is string => !!x);
    if (jd.length) out.deploy = jd.map((name) => ({ name }));
  }
  return Object.keys(out).length ? out : undefined;
};

const exRestart: Extractor = (ctx) => {
  const s = findSection(ctx.sections, "restart");
  const out: Partial<RecordFacts> = {};
  if (s) {
    const r = parseServices(s.text);
    if (r.none) out.restartNone = true;
    else if (r.services.length) out.restart = r.services;
    if (r.notes.length) out.restartNotes = r.notes;
  }
  if (!out.restart && !out.restartNone) {
    const jr = asArray(ctx.json?.restart)
      .slice(0, 30)
      .map((x) => {
        const o = asObject(x);
        const name = asString(o?.service) ?? asString(x);
        const why = asString(o?.why);
        return name ? ({ name, ...(why ? { note: why } : {}) } as ServiceFact) : null;
      })
      .filter((x): x is ServiceFact => !!x);
    if (jr.length) out.restart = jr;
  }
  // Downtime: section 5 first, then anywhere in the record.
  const sources = [s, ...ctx.sections].filter((x): x is RecordSection => !!x);
  for (const sec of sources) {
    const d = /Downtime required:\s{0,2}(yes|no|unknown)\b/i.exec(sec.text);
    if (d) {
      out.downtime = tri(d[1]);
      break;
    }
  }
  return Object.keys(out).length ? out : undefined;
};

// --- app release (6) --------------------------------------------------------------------------

const exApp: Extractor = (ctx) => {
  const s = findSection(ctx.sections, "appRelease");
  if (!s) return undefined;
  const t = trimDot(stripTags(s.text));
  let applicable: boolean | null = null;
  if (/^(not\b|none\b|n\/a)/i.test(t)) applicable = false;
  else if (/\b(build|release|store)\b/i.test(t)) applicable = true;
  return { appRelease: { applicable, refs: refsIn(t, 10), section: s.number } };
};

// --- database (7) -----------------------------------------------------------------------------

/** A sentence that asks somebody to do something (as opposed to "no new local storage"). */
const ACTION_RE = /\b(need|needed|must|require|required|run|apply|applied|sequence|profile|migration|script|list|set|create|owner to confirm|unknown|explain|index)\b/i;

const exDatabase: Extractor = (ctx) => {
  const s = findSection(ctx.sections, "database");
  if (!s) return undefined;
  const t = stripTags(s.text);
  const parts = sentences(t).map(trimDot).filter(Boolean);
  const first = parts[0] ?? "";
  // "none", "No SQL", "No schema change.", "No migration seen" all say there is nothing to run.
  const noSql = /^none\b/i.test(first) || /^no\b[^.]{0,60}\b(sql|schema|migrations?|database|db|tables?)\b/i.test(first);
  const items = (noSql ? parts.slice(1) : parts).map((x) => capStr(x, CAP)).slice(0, 30);
  // Anything beyond the "none" sentence that asks for work (or still has an open owner).
  const hasAction = (noSql ? items : parts).some((x) => !/^(no|none)\b/i.test(x) && ACTION_RE.test(x));
  const sqlPaths = Array.from(new Set(t.match(/[\w./-]{1,100}\.sql\b/g) ?? [])).slice(0, 30);
  return { database: { noSql, hasAction, items, sqlPaths, section: s.number } };
};

// --- configs (8) ------------------------------------------------------------------------------

const nk = (s: string): string => s.slice(0, 300).toLowerCase().replace(/[`\s]/g, "");

function colFor(header: string[], re: RegExp, skip?: Set<string>): string | undefined {
  return header.find((h) => !skip?.has(h) && re.test(h.trim().slice(0, 100)));
}

type Env = "demo" | "uat" | "prod";

// A Map: a header called "constructor" must not hit Object.prototype.
const ENV_WORDS = new Map<string, Env>([["demo", "demo"], ["uat", "uat"], ["staging", "uat"], ["qa", "uat"], ["prod", "prod"], ["production", "prod"]]);
/** Env words that may be glued to a tenant name ("ckcoedemo", "ckcoeprod"); "qa" only stands alone. */
const ENV_SUFFIXES: Array<[string, Env]> = [["production", "prod"], ["staging", "uat"], ["demo", "demo"], ["prod", "prod"], ["uat", "uat"]];
/** Prefixes that make "preprod" / "reproduction" something other than prod. */
const NOT_TENANT = new Set(["pre", "re", "un", "de", "non", "over", "post", "sub"]);

/**
 * The environment a table header names, if any. Dynamic: the env word may stand alone ("Demo",
 * "UAT", "Prod", "Production"), follow or precede a tenant after a space/dash/underscore/slash or
 * in brackets ("ckcoe prod", "Prod (ckcoe)", "Prod / ckcoe"), or be glued to a tenant name
 * ("ckcoedemo", "hfcoeuat", "ckcoeprod"). A tenant name without an env word ("ckcoe",
 * "Tenants today") is not an environment.
 */
export function envOfHeader(header: string): { env: Env; tenant: string | null } | null {
  if (header.length > 60) return null;
  const tokens = header.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 6) return null;
  for (let i = 0; i < tokens.length; i++) {
    const env = ENV_WORDS.get(tokens[i]);
    if (env) {
      const rest = tokens.filter((_t, j) => j !== i).join(" ");
      return { env, tenant: rest || null };
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    for (const [word, env] of ENV_SUFFIXES) {
      const t = tokens[i];
      if (t.length >= word.length + 3 && t.endsWith(word)) {
        const prefix = t.slice(0, t.length - word.length);
        if (NOT_TENANT.has(prefix)) continue;
        const rest = [prefix, ...tokens.filter((_x, j) => j !== i)].join(" ");
        return { env, tenant: rest };
      }
    }
  }
  return null;
}

/** Headers that are plain notes, not tenants. */
const NOT_A_TENANT = new Set(["owner", "notes", "note", "comment", "comments", "evidence", "who", "status", "type", "value", "values", "source", "remarks", "reason", "why", "action", "details", "detail", "description", "risk", "id", "order", "ticket", "pr"]);

/** A column that names a tenant: "Tenants today", or a lowercase single word such as "ckcoe". */
function isTenantHeader(h: string): boolean {
  const t = h.trim();
  if (/tenant/i.test(t)) return true;
  return /^[a-z][a-z0-9]{2,19}$/.test(t) && !NOT_A_TENANT.has(t);
}

function rowsFromTables(s: RecordSection): ConfigRow[] {
  const rows: ConfigRow[] = [];
  for (const table of s.tables) {
    const h = table.header;
    const keyCol = colFor(h, /^(key|name|property|config|setting)/i) ?? h[0];
    // Environment columns first (any number, any tenant naming), then store/default among the rest.
    const envCols: Array<{ col: string; env: Env; tenant: string | null }> = [];
    for (const col of h) {
      if (col === keyCol) continue;
      const e = envOfHeader(col);
      if (e) envCols.push({ col, ...e });
    }
    const envSet = new Set(envCols.map((c) => c.col));
    const skip = new Set([...envSet, ...(keyCol ? [keyCol] : [])]);
    const storeCol = colFor(h, /store|where|location|source/i, skip);
    const defCol = colFor(h, /default/i, skip);
    const used = new Set([keyCol, storeCol, defCol, ...envSet].filter(Boolean) as string[]);
    for (const r of table.rows) {
      const key = (keyCol ? r[keyCol] : undefined)?.trim();
      if (!key) continue;
      const row: ConfigRow = { key: capStr(key, CAP), source: "table" };
      if (storeCol && r[storeCol] !== undefined) row.store = r[storeCol];
      if (defCol && r[defCol] !== undefined) row.default = r[defCol];
      // demo/uat/prod: the first non-empty value among the columns of that environment (all of
      // them stay available in `byTenant`).
      const byTenant: Record<string, string> = Object.create(null);
      for (const env of ["demo", "uat", "prod"] as const) {
        const cols = envCols.filter((c) => c.env === env && r[c.col] !== undefined);
        if (!cols.length) continue;
        const pick = cols.find((c) => r[c.col].trim() !== "") ?? cols[0];
        row[env] = r[pick.col];
        for (const c of cols) if (c.tenant !== null || cols.length > 1) byTenant[c.col] = r[c.col];
      }
      if (Object.keys(byTenant).length) row.byTenant = byTenant;
      const extra: Record<string, string> = Object.create(null);
      const tenants: Record<string, string> = Object.create(null);
      let n = 0;
      let nt = 0;
      for (const [k, v] of Object.entries(r)) {
        if (used.has(k)) continue;
        extra[k] = v;
        n++;
        if (isTenantHeader(k)) {
          tenants[k] = v;
          nt++;
        }
      }
      if (n) row.extra = extra;
      if (nt) row.tenants = tenants;
      rows.push(row);
      if (rows.length >= 200) return rows;
    }
  }
  return rows;
}

function rowsFromJson(json: Record<string, unknown> | null): ConfigRow[] {
  const rows: ConfigRow[] = [];
  for (const x of asArray(json?.configs).slice(0, 200)) {
    const o = asObject(x);
    const key = asString(o?.key) ?? asString(o?.name);
    if (!o || !key) continue;
    const row: ConfigRow = { key, source: "json" };
    const store = asString(o.store);
    const def = asString(o.defaultWhenAbsent) ?? asString(o.default) ?? asString(o.defaultValue);
    if (store) row.store = store;
    if (def) row.default = def;
    for (const env of ["demo", "uat", "prod"] as const) {
      const v = asString(o[env]);
      if (v) row[env] = v;
    }
    rows.push(row);
  }
  return rows;
}

const exConfigs: Extractor = (ctx) => {
  const s = findSection(ctx.sections, "configs");
  const jsonRows = rowsFromJson(ctx.json);
  const out: Partial<RecordFacts> = {};
  if (!s) {
    if (jsonRows.length) out.configs = jsonRows;
    return Object.keys(out).length ? out : undefined;
  }
  const tableRows = rowsFromTables(s);
  const t = stripTags(s.text);
  if (tableRows.length === 0) {
    if (/^\s*(none|no\b|not applicable|n\/a)/i.test(t)) {
      out.configsNone = true;
      const refs = refsIn(t, 10);
      if (refs.length) out.configsSeeRefs = refs;
      out.configs = [];
      if (jsonRows.length) {
        ctx.warnings.push({
          code: "json_disagrees",
          path: "json:configs",
          message: `The readable section says no configs but the JSON lists ${jsonRows.length}; the readable section is used`,
        });
      }
    } else if (jsonRows.length) out.configs = jsonRows;
    return out;
  }
  const merged = tableRows.map((r) => ({ ...r }));
  for (const j of jsonRows) {
    const jk = nk(j.key);
    const hit = merged.find((r) => {
      const k = nk(r.key);
      return k === jk || (jk.length >= 6 && (k.includes(jk) || jk.includes(k)));
    });
    if (!hit) {
      merged.push(j);
      ctx.warnings.push({
        code: "json_disagrees",
        path: `json:configs[${capStr(j.key, 60)}]`,
        message: `JSON lists config ${capStr(j.key, 60)} that the readable table does not; kept as a JSON-only row`,
      });
      continue;
    }
    hit.source = "both";
    for (const f of ["store", "default", "demo", "uat", "prod"] as const) {
      const jv = j[f];
      if (jv === undefined) continue;
      const tv = hit[f];
      if (tv === undefined) hit[f] = jv;
      else if (!agree(tv, jv)) disagree(ctx, `json:configs[${capStr(j.key, 60)}].${f}`, tv, jv);
    }
  }
  out.configs = merged;
  return out;
};

// --- roles (9), compat (10) -------------------------------------------------------------------

const exRoles: Extractor = (ctx) => {
  const s = findSection(ctx.sections, "roles");
  if (!s) return undefined;
  const roles: RoleCase[] = [];
  for (const sent of sentences(stripTags(s.text))) {
    const seg = trimDot(sent);
    if (!seg) continue;
    const negative = /^Negative\b/i.test(seg);
    const idx = seg.indexOf(":");
    let who: string | null = null;
    let what = seg;
    if (idx > 0 && idx <= 100) {
      who = seg.slice(0, idx).trim();
      what = seg.slice(idx + 1).trim();
      if (negative) who = null;
    }
    roles.push({ who, what: capStr(what, CAP), negative });
    if (roles.length >= 40) break;
  }
  return roles.length ? { roles } : undefined;
};

const exCompat: Extractor = (ctx) => {
  const s = findSection(ctx.sections, "compat");
  if (!s) return undefined;
  const u = /\bUndo\b\s{0,2}[:=-]?\s{0,2}((?:[^.;\n]|\.(?!\s|$)){0,300})/i.exec(stripTags(s.text));
  return { backwardCompat: { ...(u ? { undo: capStr(u[1].trim(), CAP) } : {}), section: s.number } };
};

// --- order, gates, rollback (11) --------------------------------------------------------------

export function stepFrom(text: string): OrderStep {
  // Trim first: a step like " 1) a" must lose its marker too.
  const t = trimDot(text.trim().replace(/^\d{1,2}[.)]?\s+/, "").trim());
  return { text: capStr(t, CAP), refs: refsIn(t, 10) };
}

/**
 * Steps of section 11. `structured` is true when the text is an explicit sequence (`a -> b` or
 * numbered markers); prose like "after X, before Y" is split best-effort but not structured.
 */
export function parseSteps(pre: string): { steps: OrderStep[]; structured: boolean } {
  const t = pre.trim().slice(0, 3000);
  if (!t) return { steps: [], structured: false };
  let parts: string[];
  let structured = true;
  if (/->|\u2192|=>/.test(t)) parts = t.split(/\s{0,3}(?:->|\u2192|=>)\s{0,3}/);
  else {
    // Numbered markers 1, 2, 3 ... (consecutive from 1) split the text.
    const marks: number[] = [];
    const re = /(?:^|\s)(\d{1,2})[.)]?\s{1,3}(?=\S)/g;
    let m: RegExpExecArray | null;
    let expect = 1;
    while ((m = re.exec(t)) !== null) {
      if (parseInt(m[1], 10) === expect) {
        marks.push(m.index);
        expect++;
      }
    }
    if (marks.length >= 2 && marks[0] <= 1) {
      parts = marks.map((start, i) => t.slice(start, marks[i + 1] ?? t.length));
    } else {
      structured = false;
      parts = splitOutsideParens(t, /;\s{0,3}|\.\s{1,3}(?=[A-Z])|,?\s{1,3}then\s{1,3}/);
    }
  }
  return { steps: parts.slice(0, 40).map(stepFrom).filter((x) => x.text), structured };
}

export function labelOf(step: OrderStep): string {
  return step.refs.length ? `${step.refs[0].repo}#${step.refs[0].pr}` : capStr(step.text, 100);
}

function targetsOf(text: string): string[] {
  const refs = refsIn(text, 8);
  if (refs.length) return refs.map((r) => `${r.repo}#${r.pr}`);
  const t = trimDot(text.replace(/^the\s+/i, ""));
  return t ? [capStr(t, 100)] : [];
}

/** "after X, before Y; then Z" => X before self, self before Y, self before Z. */
function proseEdges(pre: string, self: string | null): OrderEdge[] {
  const edges: OrderEdge[] = [];
  if (!self) return edges;
  for (const clause of splitOutsideParens(pre.slice(0, 3000), /;\s{0,3}|\.\s{1,3}(?=[A-Z])/)) {
    const bits = clause.split(/,?\s{1,3}then\s{1,3}/i);
    bits.forEach((bit, i) => {
      if (i > 0) {
        for (const t of targetsOf(bit)) edges.push({ before: self, after: t });
        return;
      }
      const startsThen = /^\s{0,3}(?:and\s{1,3})?then\s{1,3}/i.exec(bit);
      if (startsThen) {
        for (const t of targetsOf(bit.slice(startsThen[0].length))) edges.push({ before: self, after: t });
        return;
      }
      const a = /\b(?:after|once)\s{1,3}(.{1,300}?)(?:,?\s{1,3}before\b|$)/i.exec(bit);
      if (a) for (const t of targetsOf(a[1])) edges.push({ before: t, after: self });
      const b = /\bbefore\s{1,3}(.{1,200})$/i.exec(bit);
      if (b) for (const t of targetsOf(b[1])) edges.push({ before: self, after: t });
    });
    if (edges.length >= 60) break;
  }
  return edges;
}

export function chainEdges(steps: OrderStep[]): OrderEdge[] {
  const edges: OrderEdge[] = [];
  for (let i = 0; i + 1 < steps.length; i++) {
    const a = labelOf(steps[i]);
    const b = labelOf(steps[i + 1]);
    if (a && b && a !== b) edges.push({ before: a, after: b });
  }
  return edges;
}

export function dedupeEdges(edges: OrderEdge[]): OrderEdge[] {
  const seen = new Set<string>();
  const out: OrderEdge[] = [];
  for (const e of edges) {
    const k = `${e.before}\u0000${e.after}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    if (out.length >= 60) break;
  }
  return out;
}

const exOrder: Extractor = (ctx) => {
  const s = findSection(ctx.sections, "order");
  const jo = asObject(ctx.json?.order);
  const jsonSteps = asArray(jo?.steps)
    .slice(0, 40)
    .map((x) => (typeof x === "string" ? x.trim() : (asString(asObject(x)?.step) ?? asString(asObject(x)?.text) ?? "")))
    .filter(Boolean)
    .map((x) => capStr(x, CAP));
  if (!s && jsonSteps.length === 0) return undefined;
  const t = s ? stripTags(s.text) : "";
  const gm = /\bGates?\s{0,2}:\s{0,2}/i.exec(t);
  const rm = /\bRollback\s{0,2}:\s{0,2}/i.exec(t);
  const firstLabel = Math.min(gm ? gm.index : t.length, rm ? rm.index : t.length);
  const pre = t.slice(0, firstLabel);
  const parsed = s ? parseSteps(pre) : { steps: [] as OrderStep[], structured: false };
  const textSteps = parsed.steps;
  // JSON `order.steps` is a clean list; explicit text sequences (`->`, numbered) are richer and
  // win. Prose that was only split best-effort gives way to the JSON steps when there are any.
  const useText = textSteps.length > 0 && (parsed.structured || jsonSteps.length === 0);
  const steps = useText ? textSteps : jsonSteps.map(stepFrom);
  let gates: string[] = [];
  if (gm) {
    const start = gm.index + gm[0].length;
    const end = rm && rm.index > start ? rm.index : t.length;
    gates = splitOutsideParens(t.slice(start, end), /;\s{0,3}|\n/)
      .map((x) => capStr(trimDot(x), CAP))
      .filter(Boolean)
      .slice(0, 30);
  }
  const self = ctx.self ? `${ctx.self.repo}#${ctx.self.pr}` : null;
  const edges = dedupeEdges([...chainEdges(steps), ...(parsed.structured ? [] : proseEdges(pre, self))]);
  const order: NonNullable<RecordFacts["order"]> = {
    steps,
    stepsSource: useText ? "text" : "json",
    structured: parsed.structured && textSteps.length > 0,
    edges,
    gates,
    ...(rm ? { rollback: capStr(trimDot(t.slice(rm.index + rm[0].length)), CAP) } : {}),
  };
  if (jsonSteps.length) {
    order.jsonSteps = jsonSteps;
    if (parsed.structured && textSteps.length !== jsonSteps.length) {
      disagree(ctx, "json:order.steps", `${textSteps.length} steps`, `${jsonSteps.length} steps`);
    }
  }
  return { order };
};

// --- risks (13) -------------------------------------------------------------------------------

function sev(label: string): Severity | null {
  const l = label.toLowerCase();
  if (l.startsWith("block")) return "Blocking";
  if (l.startsWith("should")) return "Should-fix";
  if (l.startsWith("nit")) return "Nitpick";
  return null;
}

export function parseRisks(text: string, title: string): RiskItem[] {
  // Bullets ("- Blocking: x", "1. x", "* x") lose their list prefix before anything is split.
  const t = stripTags(text)
    .split("\n")
    .map((l) => l.replace(/^\s{0,12}(?:[-*•]|\d{1,3}[.)])\s{1,3}/, ""))
    .join("\n");
  const out: RiskItem[] = [];
  const labelRe = /\b(Blocking|Should-?fix|Nit(?:pick)?s?)\s{0,2}:\s{0,2}/gi;
  const marks: Array<{ at: number; end: number; severity: Severity | null }> = [];
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(t)) !== null && marks.length < 100) marks.push({ at: m.index, end: m.index + m[0].length, severity: sev(m[1]) });
  const titleSev = /\((Blocking|Should-?fix|Nit(?:pick)?s?)\)/i.exec(title.slice(0, 200));
  const segs: Array<{ severity: Severity | null; body: string }> = [];
  const lead = t.slice(0, marks[0]?.at ?? t.length);
  if (lead.trim()) segs.push({ severity: titleSev ? sev(titleSev[1]) : null, body: lead });
  marks.forEach((mk, i) => segs.push({ severity: mk.severity, body: t.slice(mk.end, marks[i + 1]?.at ?? t.length) }));
  for (const sg of segs) {
    const numbered = sg.body.split(/(?=\(\d{1,2}\)\s)/);
    for (const item of numbered.flatMap((n) => splitOutsideParens(n, /;\s{0,3}|\n/))) {
      const txt = trimDot(item.replace(/^\(\d{1,2}\)\s{0,3}/, "").replace(/\.\s{0,3}No\s{1,3}[\w-]{1,20}\s{1,3}open\.?$/i, ""));
      if (!txt || /^(no|none)\b[^.]{0,40}\bopen\b/i.test(txt)) continue;
      out.push({ severity: sg.severity, text: capStr(txt, 400), source: "text" });
      if (out.length >= 80) return out;
    }
  }
  return out;
}

const exRisks: Extractor = (ctx) => {
  const s = findSection(ctx.sections, "risks");
  const jsonRisks: RiskItem[] = asArray(ctx.json?.risks)
    .slice(0, 80)
    .map((x) => {
      const o = asObject(x);
      const text = asString(o?.text) ?? asString(x);
      return text ? ({ severity: sev(asString(o?.sev) ?? asString(o?.severity) ?? ""), text, source: "json" } as RiskItem) : null;
    })
    .filter((x): x is RiskItem => !!x);
  if (!s && !jsonRisks.length) return undefined;
  const textRisks = s ? parseRisks(s.text, s.title) : [];
  const risks = textRisks.length ? textRisks : jsonRisks;
  if (textRisks.length && jsonRisks.length) {
    for (const sv of ["Blocking", "Should-fix"] as const) {
      const a = textRisks.filter((r) => r.severity === sv).length;
      const b = jsonRisks.filter((r) => r.severity === sv).length;
      if (a !== b) disagree(ctx, `json:risks.${sv}`, `${a} ${sv}`, `${b} ${sv}`);
    }
  }
  return risks.length ? { risks } : undefined;
};

// --- testing (12), verification (14) ----------------------------------------------------------

const exTesting: Extractor = (ctx) => {
  const s = findSection(ctx.sections, "testing");
  if (!s) return undefined;
  const t = stripTags(s.text);
  // The first "<n> [word] tests": "29 partner-banner tests, 247 suites; 12 tests pass" => 29.
  const tc = /(\d{1,6})\s{1,3}(?:[\w-]{1,30}\s{1,3}){0,2}?tests?\b/i.exec(t);
  return {
    testing: {
      ...(tc ? { testCount: parseInt(tc[1], 10) } : {}),
      ...(/\bno CI\b/i.test(t) ? { noCi: true } : {}),
      ...(/not run by me/i.test(t) ? { notRunByReviewer: true } : {}),
      section: s.number,
    },
  };
};

const exVerify: Extractor = (ctx) => {
  const s = findSection(ctx.sections, "verify");
  if (!s) return undefined;
  const items = splitOutsideParens(stripTags(s.text), /;\s{0,3}|\n/)
    .map((x) => capStr(trimDot(x), CAP))
    .filter(Boolean)
    .slice(0, 40);
  return items.length ? { verification: items } : undefined;
};

// ---------------------------------------------------------------------------------------------

const EXTRACTORS: Array<[string, Extractor]> = [
  ["header", exHeader],
  ["branches", exBranches],
  ["prodBranch", exProdBranch],
  ["deploy", exDeploy],
  ["restart", exRestart],
  ["appRelease", exApp],
  ["database", exDatabase],
  ["configs", exConfigs],
  ["roles", exRoles],
  ["compat", exCompat],
  ["order", exOrder],
  ["risks", exRisks],
  ["testing", exTesting],
  ["verify", exVerify],
];

/**
 * Resolve written repo aliases ("Flutter #49", "auth-service #332") to the full names the record
 * itself uses (its own repo and the siblings) by unique suffix match; the written name is kept in
 * `written`. Unresolved aliases are left as written.
 */
function resolveAliases(facts: RecordFacts, ctx: FactsCtx): void {
  const pool = new Set<string>();
  if (ctx.self) pool.add(ctx.self.repo);
  for (const s of facts.siblings ?? []) pool.add(s.repo);
  if (pool.size === 0) return;
  const fix = (r: PrRef): void => {
    const full = resolveAlias(r.repo, pool);
    if (full !== r.repo) {
      r.written = r.repo;
      r.repo = full;
    }
  };
  for (const s of facts.siblings ?? []) fix(s);
  for (const r of facts.configsSeeRefs ?? []) fix(r);
  for (const r of facts.appRelease?.refs ?? []) fix(r);
  for (const st of facts.order?.steps ?? []) for (const r of st.refs) fix(r);
  for (const r of facts.replaces ?? []) {
    if (r.repo) r.repo = resolveAlias(r.repo, pool);
  }
  // A service written as a short repo name ("auth-service") becomes the full repo name.
  for (const list of [facts.deploy, facts.restart]) {
    for (const sv of list ?? []) {
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(sv.name)) continue;
      const full = resolveAlias(sv.name, pool);
      if (full !== sv.name) {
        sv.written = sv.name;
        sv.name = full;
      }
    }
  }
  const label = (s: string): string => {
    const m = /^([A-Za-z][\w.-]{0,79})#(\d{1,6})$/.exec(s);
    return m ? `${resolveAlias(m[1], pool)}#${m[2]}` : s;
  };
  if (facts.order) {
    facts.order.edges = dedupeEdges(facts.order.edges.map((e) => ({ before: label(e.before), after: label(e.after) })));
  }
}

/** Run every extractor independently; a throwing one is reported and skipped. */
export function extractFacts(ctx: FactsCtx): RecordFacts {
  const facts: RecordFacts = {};
  for (const [name, fn] of EXTRACTORS) {
    try {
      const part = fn(ctx);
      if (part) Object.assign(facts, part);
    } catch (e) {
      ctx.warnings.push({
        code: "extractor_failed",
        path: `facts:${name}`,
        message: `Extractor ${name} failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  try {
    resolveAliases(facts, ctx);
  } catch (e) {
    ctx.warnings.push({
      code: "extractor_failed",
      path: "facts:aliases",
      message: `Alias resolution failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  return facts;
}
