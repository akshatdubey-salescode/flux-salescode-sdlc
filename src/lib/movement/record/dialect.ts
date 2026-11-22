/**
 * The free-form ("dialect") record: ALL-CAPS label lines (STATUS, WHAT, ORDER, OPEN, UNDO,
 * VERIFY, LIKELY TO BE MISSED, MERGED PRs ...) and the numbered rows of the Confluence release
 * page, laid out in a monospaced block:
 *
 *   STATUS   HELD in the DEMO movement (blocked) · PARTIAL
 *   MERGED PRs (all approved and merged by X, 17 Nov; author Y)
 *     slake-custom-reports#931     main   689b6d326c   executor
 *    1  Production meeting + everyone invited   unknown (release manager)
 *   11  Configs to add in prod                  Not Done: param ...
 *         continuation line
 *
 * Everything here is best effort and independent; nothing is invented: a value that cannot be
 * read cleanly stays in the raw row/label text. Every extracted string is a contiguous piece of
 * the (normalised) text, which the record keeps as `body`. Input text has already been through
 * `normalizeDialect`, so regexes see single-line strings of at most 2000 characters with bounded
 * blank runs.
 */
import { chainEdges, dedupeEdges, parseServices, stepFrom } from "./facts";
import type {
  ConfigRow,
  Cover,
  OrderStep,
  PrRef,
  RecordFacts,
  ReleaseRow,
  ReleaseRowId,
  RiskItem,
  RowState,
  ServiceFact,
  UnknownItem,
  LabelledBlock,
} from "./types";
import { capStr, cleanText, outsideParens, refsWithPos, splitOutsideParens, trimDot } from "./util";

export const MAX_DIALECT_CHARS = 20_000;
const MAX_LINES = 400;
const MAX_LINE = 2000;
const MAX_BLOCKS = 40;
const MAX_ROWS = 60;
const MAX_COVERS = 40;

/** Tabs become two blanks (a column gap), CRLF becomes LF, blank runs and long words are capped. */
export function normalizeDialect(raw: string): { text: string; truncated: boolean } {
  let truncated = false;
  let src = raw;
  if (src.length > MAX_DIALECT_CHARS * 4) {
    src = src.slice(0, MAX_DIALECT_CHARS * 4);
    truncated = true;
  }
  const lines = src.replace(/\r\n?/g, "\n").replace(/\t/g, "  ").split("\n");
  if (lines.length > MAX_LINES) truncated = true;
  const out: string[] = [];
  let chars = 0;
  for (const l of lines.slice(0, MAX_LINES)) {
    const line = cleanText(l.length > MAX_LINE ? l.slice(0, MAX_LINE) : l, 8).trimEnd();
    chars += line.length + 1;
    if (chars > MAX_DIALECT_CHARS) {
      truncated = true;
      break;
    }
    out.push(line);
  }
  return { text: out.join("\n"), truncated };
}

// ---------------------------------------------------------------------------------------------
// Line shapes
// ---------------------------------------------------------------------------------------------

/** ` 11  Configs to add in prod   Not Done: ...`: a number, then a column gap. */
const ROW_RE = /^ {0,4}(\d{1,2}) {2,40}(\S.*)$/;
/** `STATUS   text`, `ORDER    text`, `LIKELY TO BE MISSED` alone, `MERGED PRs (text)`. */
const WORD = "[A-Z][A-Z&/-]*s?";
const LABEL_RE = new RegExp(`^(${WORD}(?: ${WORD}){0,6})(?: {2,40}(\\S.*)| (\\(.*)| *)$`);
/** `STILL OPEN:` / `STILL OPEN: repo#1`: the same words, closed by a colon. */
const LABEL_COLON_RE = new RegExp(`^(${WORD}(?: ${WORD}){0,6}):(?: +(\\S.*))? *$`);
/** PR sub-list labels in any case: still open, reverted, do not deploy, stack branches. */
const GROUP_LABEL_RE =
  /^ {0,4}(still open(?: prs?)?|open prs?|reverted(?: prs?)?|do not deploy(?: as features)?|stack branches|merged into stack(?: branches)?(?: only)?)\b[ :(-]{0,4}(.{0,300})$/i;
/** "Test owner per area: ..." / "Owners: ..." in any case. */
const OWNERS_LABEL_RE = /^ {0,4}(test owners?(?: per area)?|owners)\b *[:-] *(.{0,500})$/i;

interface Label {
  label: string;
  rest: string;
  /** The label as written, when it was normalised. */
  written?: string;
}

function labelOf(line: string): Label | null {
  const g = GROUP_LABEL_RE.exec(line);
  if (g) return { label: g[1].trim(), rest: g[2].trim() };
  const ow = OWNERS_LABEL_RE.exec(line);
  if (ow) return { label: ow[1].trim(), rest: ow[2].trim() };
  const m = LABEL_COLON_RE.exec(line) ?? LABEL_RE.exec(line);
  if (!m) return null;
  const label = m[1];
  if (label.length < 3 || label.length > 50) return null;
  // A sentence that merely starts in capitals ("OK we deploy") has no column gap, "(" or colon:
  // the regexes need one of them (or the end of the line).
  const rest = (m[2] ?? m[3] ?? "").trim();
  // "LIKELY TO BE MISSED IN TESTING" is the same block as "LIKELY TO BE MISSED".
  if (/^LIKELY TO BE MISSED\b/.test(label) && label !== "LIKELY TO BE MISSED") return { label: "LIKELY TO BE MISSED", rest, written: label };
  return { label, rest };
}

/** True when the text looks like a free-form record: several label lines and/or numbered rows. */
export function looksDialect(text: string): boolean {
  let rows = 0;
  let labels = 0;
  const lines = text.split("\n", MAX_LINES);
  for (const l of lines) {
    if (l.length > MAX_LINE) continue;
    if (ROW_RE.test(l)) rows++;
    else if (labelOf(l)) labels++;
    if (rows >= 3 || labels >= 3) return true;
  }
  return (rows >= 1 && labels >= 2) || (rows >= 2 && labels >= 1);
}

// ---------------------------------------------------------------------------------------------
// Row ids, states
// ---------------------------------------------------------------------------------------------

const ROW_IDS: ReleaseRowId[] = [
  "meeting",
  "services_deploy",
  "app_release",
  "code_reviewed",
  "previous_data",
  "new_app_old_data",
  "db_queries",
  "db_index",
  "bundle_reviewed",
  "bundle_sdk",
  "configs_prod",
  "services_restart",
  "ui_reviewed",
  "ui_indexdb",
  "performance",
  "automation_run",
  "automation_updated",
  "features_old_data",
  "beta_compat",
  "designations",
  "old_app_version",
  "scenarios",
  "cherry_pick",
];

/** Fuzzy label rules; the more specific ones come first ("UI index" before "DB index"). */
const ROW_LABELS: Array<[RegExp, ReleaseRowId]> = [
  [/\bmeeting\b|everyone invited/i, "meeting"],
  [/services?\s+to\s+restart|\brestart\b/i, "services_restart"],
  [/services?\s+to\s+deploy/i, "services_deploy"],
  [/\bui\b.*\bindex/i, "ui_indexdb"],
  [/\bui\s+code/i, "ui_reviewed"],
  [/bundle\s+sdk/i, "bundle_sdk"],
  [/bundle\s+code/i, "bundle_reviewed"],
  [/^app\s+release|\bapp\s+release\b/i, "app_release"],
  [/old\s+version\s+of\s+(the\s+)?existing\s+app|test\s+old\s+version/i, "old_app_version"],
  [/new\s+app\s+(works?\s+)?with\s+old\s+data/i, "new_app_old_data"],
  [/features?\s+(work\s+)?with\s+old\s+data/i, "features_old_data"],
  [/previous\s+data/i, "previous_data"],
  [/\bdb\b.*\bindex|index\s+quer/i, "db_index"],
  [/\bdb\b.*\bquer|change\s+quer|sql/i, "db_queries"],
  [/configs?\b/i, "configs_prod"],
  [/performance/i, "performance"],
  [/automation.*(updated|update)/i, "automation_updated"],
  [/automation/i, "automation_run"],
  [/beta\s+app|backward\s+compat/i, "beta_compat"],
  [/designations?/i, "designations"],
  [/scenarios?/i, "scenarios"],
  [/cherry/i, "cherry_pick"],
  [/code\s+reviewed/i, "code_reviewed"],
];

function fuzzyId(label: string): ReleaseRowId | null {
  const l = label.slice(0, 120);
  for (const [re, id] of ROW_LABELS) if (re.test(l)) return id;
  return null;
}

const STATE_RULES: Array<[RegExp, RowState]> = [
  [/^not\s+done\b/i, "not_done"],
  [/^not\s+(required|needed|applicable)\b/i, "not_required"],
  [/^n\/a\b/i, "not_required"],
  [/^done\b/i, "done"],
  [/^yes\b/i, "yes"],
  [/^no\b/i, "no"],
  [/^unknown\b/i, "unknown"],
];

export function stateOf(answer: string): { state: RowState; text: string } {
  const a = answer.trimStart();
  for (const [re, state] of STATE_RULES) {
    const m = re.exec(a);
    if (m) {
      let rest = a.slice(m[0].length).replace(/^[\s:,;.–—-]{1,10}/, "");
      // "Done (none)" / "unknown (QA)": the whole remainder in one pair of parentheses.
      if (rest.startsWith("(") && rest.endsWith(")") && !rest.slice(1, -1).includes("(")) rest = rest.slice(1, -1).trim();
      return { state, text: rest };
    }
  }
  return { state: "other", text: a };
}

function ownerOf(answer: string): string | null {
  const m = /^unknown\s{0,3}\(([^)]{1,60})\)/i.exec(answer.trimStart()) ?? /owner to confirm\s{0,3}:\s{0,3}([^.;,()[\]]{1,60})/i.exec(answer);
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

export interface Dialect {
  labelled: LabelledBlock[];
  rows: ReleaseRow[];
  /** Only the MERGED PRs block. */
  covers: Cover[];
  unknowns: UnknownItem[];
  stillOpen: Cover[];
  reverted: Cover[];
  stackOnly: Cover[];
}

type PrGroup = "merged" | "open" | "reverted" | "stack" | "generic";

/** Which PR list a label introduces; null when the label is not a PR list. */
function prGroup(label: string): PrGroup | null {
  if (/stack/i.test(label)) return "stack";
  if (/^(still open|open prs?)\b/i.test(label)) return "open";
  if (/^reverted|do not deploy/i.test(label)) return "reverted";
  if (/^merged\b/i.test(label)) return "merged";
  if (/\bPRs?$/.test(label)) return "generic";
  return null;
}

/** A base that is not master / main / ckcoe (nor a prod/release/hotfix branch) is a stack or feature branch. */
function isStackBase(base: string | undefined): boolean {
  if (!base) return false;
  return !/^(master|main|ckcoe|develop|prod[-_].*|hotfix\/.*|release.*|papa|AAckcoe|stocks-prod.*)$/i.test(base);
}

/** `how: unknown (devops)`, `how: unknown, devops`, `unknown, owner to confirm: X` within an answer. */
const INNER_UNKNOWN_RE = /\b(?:[a-z ]{1,20}:\s{0,3})?unknown\s{0,3}\(([^)]{1,60})\)|\bhow:\s{0,3}unknown,\s{0,3}([a-z][\w -]{1,30})(?=[).;]|$)|unknown,\s{0,3}owner to confirm\s{0,3}:\s{0,3}([^.;,()[\]]{1,60})/gi;

const SHA_RE = /^[0-9a-f]{7,40}$/;

function parseCoverLine(line: string, state: Cover["state"]): Cover[] {
  const t = line.trim();
  if (!t) return [];
  const refs = refsWithPos(t, 10);
  if (refs.length === 0) return [];
  // "repo#1, repo#2": several refs in one line, no columns.
  if (refs.length > 1) return refs.map((r) => ({ repo: r.repo, pr: r.pr, ...(state ? { state } : {}) }));
  const c: Cover = { repo: refs[0].repo, pr: refs[0].pr };
  if (state) c.state = state;
  // `repo#n  base  merge-commit  what it does`: base and commit are single words, so split on any
  // blanks; "-" is a placeholder for a missing column.
  const rest = t.slice(refs[0].end).trim();
  const tokens = rest.split(/\s+/);
  let i = 0;
  const placeholder = (x: string): boolean => x === "-" || x === "\u2014" || x === "\u2013";
  while (i < tokens.length && placeholder(tokens[i])) i++;
  if (i < tokens.length && !SHA_RE.test(tokens[i]) && /^[\w./-]{1,80}$/.test(tokens[i]) && !/^\d{1,3}$/.test(tokens[i])) c.branch = tokens[i++];
  while (i < tokens.length && placeholder(tokens[i])) i++;
  if (i < tokens.length && SHA_RE.test(tokens[i])) c.sha = tokens[i++];
  const note = tokens.slice(i).join(" ").replace(/^[-\u2014\u2013]\s{1,3}/, "").trim();
  if (note) {
    c.note = capStr(note, 200);
    if (/no formal approval/i.test(note)) c.approval = "no formal approval";
  }
  return [c];
}

export function parseDialect(text: string): Dialect {
  const lines = text.split("\n");
  const labelled: LabelledBlock[] = [];
  const rows: ReleaseRow[] = [];
  type Cur = { kind: "label"; block: { label: string; parts: string[]; written?: string } } | { kind: "row"; n: number; label: string; parts: string[] } | null;
  let cur: Cur = null;
  const flush = (): void => {
    if (!cur) return;
    if (cur.kind === "label") {
      const parts = cur.block.parts.filter(Boolean);
      if (labelled.length < MAX_BLOCKS) {
        labelled.push({ label: cur.block.label, text: parts.join("\n"), lines: parts.slice(0, 30).map((p) => capStr(p, 500)), ...(cur.block.written ? { written: cur.block.written } : {}) });
      }
    } else if (rows.length < MAX_ROWS) {
      const partsNonEmpty = cur.parts.filter(Boolean);
      const answer = partsNonEmpty.join(" ");
      const { state, text: rest } = stateOf(answer);
      rows.push({
        n: cur.n,
        id: null,
        label: cur.label,
        answer: capStr(answer, 1000),
        ...(partsNonEmpty.length > 1 ? { lines: partsNonEmpty.slice(0, 30).map((p) => capStr(p, 500)) } : {}),
        state,
        text: capStr(rest, 1000),
      });
    }
    cur = null;
  };

  // The header (marker + supersedes) lines are not part of any block.
  let start = 0;
  while (start < lines.length && start < 3 && (/DEPLOYMENT-RECORD/i.test(lines[start]) || /^\s{0,4}supersedes\s{0,3}:/i.test(lines[start]))) start++;

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      continue;
    }
    const rm = ROW_RE.exec(line);
    if (rm) {
      flush();
      const body = rm[2];
      const gap = body.search(/ {2,}/);
      cur = { kind: "row", n: parseInt(rm[1], 10), label: gap < 0 ? body.trim() : body.slice(0, gap), parts: [gap < 0 ? "" : body.slice(gap).trim()] };
      continue;
    }
    const lb = labelOf(line);
    if (lb) {
      flush();
      cur = { kind: "label", block: { label: lb.label, parts: [lb.rest], ...(lb.written ? { written: lb.written } : {}) } };
      continue;
    }
    // A continuation line of the label block / row above (or stray text before any: ignored).
    if (cur) {
      if (cur.kind === "label") cur.block.parts.push(line.trim());
      else cur.parts.push(line.trim());
    }
  }
  flush();

  // Fuzzy label first; a row whose label matches nothing falls back to its number, unless another
  // row already holds that id; otherwise the id stays null.
  const taken = new Set<ReleaseRowId>();
  for (const r of rows) {
    r.id = fuzzyId(r.label);
    if (r.id) taken.add(r.id);
  }
  for (const r of rows) {
    if (r.id) continue;
    const byNumber = r.n >= 1 && r.n <= ROW_IDS.length ? ROW_IDS[r.n - 1] : null;
    if (byNumber && !taken.has(byNumber)) {
      r.id = byNumber;
      taken.add(byNumber);
    }
  }

  // PR lines. Only the MERGED PRs block is the union (`covers`); the other PR groups are named
  // but never counted: STILL OPEN, REVERTED / DO NOT DEPLOY, STACK BRANCHES. Lines after a label
  // belong to it until the next label or blank line (the block structure above). A PR written
  // outside any such block (free text) is not a cover.
  const covers: Cover[] = [];
  const generic: Cover[] = [];
  const stillOpen: Cover[] = [];
  const reverted: Cover[] = [];
  const stackOnly: Cover[] = [];
  const addTo = (list: Cover[], c: Cover): void => {
    if (list.length < MAX_COVERS && !list.some((x) => x.repo === c.repo && x.pr === c.pr)) list.push(c);
  };
  for (const b of labelled) {
    const group = prGroup(b.label);
    if (!group) continue;
    const state: Cover["state"] = group === "open" ? "open" : group === "generic" ? undefined : "merged";
    // "(all approved and merged by X, 17 Nov; author Y)" / "(no formal approval)" on the label line.
    const head = b.lines[0] ?? "";
    const blockApproval = parseCoverLine(head, state).length === 0 && /approv/i.test(head) ? capStr(head.replace(/^\(|\)$/g, "").trim(), 200) : undefined;
    for (const l of b.lines) {
      for (const c of parseCoverLine(l, state)) {
        if (blockApproval && c.approval === undefined && group === "merged") c.approval = blockApproval;
        if (group === "merged") addTo(isStackBase(c.branch) ? stackOnly : covers, c);
        else if (group === "generic") addTo(isStackBase(c.branch) ? stackOnly : generic, c);
        else if (group === "open") addTo(stillOpen, c);
        else if (group === "reverted") addTo(reverted, c);
        else addTo(stackOnly, c);
      }
    }
  }
  if (covers.length === 0) for (const c of generic) addTo(covers, c);

  const unknowns: UnknownItem[] = [];
  const seenUnknown = new Set<string>();
  const addUnknown = (u: UnknownItem): void => {
    const k = `${u.text}|${u.owner}|${u.row ?? ""}`;
    if (!seenUnknown.has(k)) {
      seenUnknown.add(k);
      unknowns.push(u);
    }
  };
  for (const r of rows) {
    const rowText = capStr(`${r.label} ${r.answer}`, 200);
    if (r.state === "unknown") {
      addUnknown({ text: rowText, owner: ownerOf(r.answer), section: null, row: r.n, ...(r.id ? { rowId: r.id } : {}) });
      continue;
    }
    // "how: unknown (devops)", "how: unknown, devops" and "unknown, owner to confirm: X" inside an answer.
    INNER_UNKNOWN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INNER_UNKNOWN_RE.exec(r.answer)) !== null && unknowns.length < 100) {
      const owner = (m[1] ?? m[2] ?? m[3] ?? "").trim() || null;
      addUnknown({ text: rowText, owner, section: null, row: r.n, ...(r.id ? { rowId: r.id } : {}) });
    }
  }
  return { labelled, rows, covers, unknowns, stillOpen, reverted, stackOnly };
}

// ---------------------------------------------------------------------------------------------
// Feeding the existing facts
// ---------------------------------------------------------------------------------------------

const rowOf = (d: Dialect, id: ReleaseRowId): ReleaseRow | undefined => d.rows.find((r) => r.id === id);
const labelBlock = (d: Dialect, re: RegExp): LabelledBlock | undefined => d.labelled.find((b) => re.test(b.label));

/** `repo` of a "executor #931" reference: the cover PR with that number when there is exactly one. */
function resolveByCovers(ref: PrRef, covers: Cover[]): PrRef {
  if (covers.some((c) => c.repo === ref.repo && c.pr === ref.pr)) return ref;
  const hit = covers.filter((c) => c.pr === ref.pr);
  if (hit.length === 1) return { ...ref, repo: hit[0].repo, written: ref.repo };
  return ref;
}

export interface DialectStatus {
  status: "READY" | "PARTIAL" | "BLOCKED" | null;
  statusText: string | null;
}

/** HELD / blocked / NOT READY win over PARTIAL, which wins over READY. */
export function dialectStatus(d: Dialect): DialectStatus {
  const b = labelBlock(d, /^STATUS$/i);
  if (!b) return { status: null, statusText: null };
  const t = b.text.split("\n")[0];
  const status = /\b(held|blocked|not ready)\b/i.test(t) ? "BLOCKED" : /\bpartial\b/i.test(t) ? "PARTIAL" : /\bready\b/i.test(t) ? "READY" : null;
  return { status, statusText: capStr(t, 300) };
}

/** Identifiers worth listing from a configs row: snake_case names and dotted keys. */
const KEY_RE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\b[a-z][a-z0-9]{1,}(?:\.[a-z][a-z0-9]{1,})+\b/g;

/** A clause that says what is NOT done ("No bundle, no Slake", "Nothing for Channel Kart, bundle, UI or app"): never a service. */
const NEGATIVE_RE = /^(?:no|nothing|none|not|without)\b/i;
/** The start of a sentence, not of a name ("Then the salesrep syncs", "After the merge ..."). */
const SENTENCE_START_RE = /^(?:then|after|before|when|once|so|if|because|plus)\b/i;
/** "saleslens", "auth service", "KPI Dashboard - UI": a name. "ckcoedemo only" (a tenant qualifier), "to restore the state: X" (prose) are not. */
function looksLikeServiceName(name: string, written: string): boolean {
  if (name.includes(":") || /^to\b/i.test(name)) return false;
  // a clause about people or the app, not a service: "Users log out", "The app is an app-store release"
  if (/^(?:users?|the app|app is|salesreps?|they|it)\b/i.test(name) || /\blog (?:in|out)\b|\bto pick up\b/i.test(name)) return false;
  if (/^[A-Z0-9]/.test(name) || /[-_.]/.test(name)) return true;
  const words = name.split(/\s+/).length;
  return words <= 2 && !(words === 1 && /\sonly$/i.test(written));
}

const LIST_SEP = /[;,]\s{0,3}|\s+and\s+|\s+\u00b7\s+|\s+\+\s+/i;
/** One piece of a service list that can be a service name (not a negation, a sentence start, an owner question or prose). */
function pieceOk(raw: string): boolean {
  const w = trimDot(raw.replace(/^the\s+/i, ""));
  const nm = w.indexOf("(") >= 0 ? w.slice(0, w.indexOf("(")).trim() : w;
  return !!nm && !NEGATIVE_RE.test(w) && !SENTENCE_START_RE.test(w) && !/owner to confirm|^how\b|:\s{0,3}unknown/i.test(outsideParens(w)) && outsideParens(w).trim().split(/\s+/).length <= 7 && looksLikeServiceName(nm.replace(/\s+only$/i, ""), nm);
}

/** The service tick list of row 2 / 12: one or several lines; sentences, then "A · B", "A, B", "A; B", "A and B" inside a sentence. */
function servicesOfRow(r: ReleaseRow): { services: ServiceFact[]; notes: string[] } {
  const lines = r.lines ?? [r.answer];
  // For "Done: Channel Kart, Stock" the state word is not a service.
  const first = r.state === "done" || r.state === "yes" ? [r.text] : [lines[0]];
  // a bracket that the comment wrapped over two lines ("(how: unknown (devops)" / ")") is one text again
  const joined: string[] = [];
  for (const l of [...first, ...lines.slice(1)]) {
    const prev = joined[joined.length - 1];
    if (prev !== undefined && (prev.match(/\(/g) ?? []).length > (prev.match(/\)/g) ?? []).length) joined[joined.length - 1] = `${prev} ${l.trim()}`;
    else joined.push(l);
  }
  const sentences = joined.flatMap((l) => splitOutsideParens(l, /\.\s{1,3}(?=[A-Z]|[a-z][\w]*[-.][\w.-]*:|[a-z][a-z0-9]*:\s)/));
  const services: ServiceFact[] = [];
  const notes: string[] = [];
  const note = (t: string): void => {
    if (t && notes.length < 10) notes.push(capStr(t, 300));
  };
  const addService = (written0: string, tail: string): void => {
    const head = written0.trim();
    const hOpen = head.indexOf("(");
    const written = (hOpen >= 0 ? head.slice(0, hOpen) : head).trim();
    const close = hOpen >= 0 ? head.lastIndexOf(")") : -1;
    const inner = hOpen >= 0 && close > hOpen ? head.slice(hOpen + 1, close).trim() : "";
    const name = capStr(written.replace(/\s+only$/i, ""), 100);
    const svcNote = [inner, tail.trim()].filter(Boolean).join("; ");
    if (!name) return;
    if (!looksLikeServiceName(name, written)) {
      note(written0 + (tail ? `: ${tail}` : ""));
      return;
    }
    if (services.length < 30) services.push({ name, ...(svcNote ? { note: capStr(svcNote, 200) } : {}) });
  };
  for (let sentence of sentences) {
    sentence = trimDot(sentence.replace(/(^|[;,]\s{0,3})(?:extras?|also|plus)\s{0,3}:?\s{1,3}/gi, "$1"));
    // "No bundle, no Slake." / "Nothing for Channel Kart, bundle, UI or app": the whole sentence says what is left out
    if (!sentence) continue;
    // "(the report is a DB query row, no jar; no Slake)" on a line of its own: a remark about the service before it
    const remark = /^\(([^()]*(?:\([^()]*\)[^()]*)*)\)$/.exec(sentence);
    if (remark && services.length) {
      const last = services[services.length - 1];
      last.note = capStr([last.note, remark[1].trim()].filter(Boolean).join("; "), 300);
      continue;
    }
    if (NEGATIVE_RE.test(sentence)) {
      note(sentence);
      continue;
    }
    // "Slake Reporting: config and schedule reload, plus cache clear": a name, a colon, then what is done (not a list)
    const colon = /^([^:()]{2,50}):\s{0,3}(\S.*)$/.exec(sentence);
    if (colon && !/[;,\u00b7]/.test(colon[1]) && !/owner to confirm|^how\b|^unknown/i.test(colon[1]) && !/^\s*unknown/i.test(colon[2])) {
      // "ckcoedemo: bundle reload after the jar rebuild; Slake Reporting config reload ...": a tenant, then several things done there: one note
      if (/^[a-z][a-z0-9]*$/.test(colon[1].trim()) && colon[2].includes(";")) {
        note(sentence);
        continue;
      }
      if (colon[1].trim().split(/\s+/).length <= 5 && !SENTENCE_START_RE.test(colon[1])) {
        addService(colon[1], colon[2]);
        continue;
      }
      // "ckcoedemo only, to restore the state: A (jar), B, C": the lead-in is a note, the rest is the list.
      // "Transformer registry and report query cache: refresh or restart": no service in the rest, so the sentence is ONE note.
      if (!splitOutsideParens(colon[2], LIST_SEP).some(pieceOk)) {
        note(sentence);
        continue;
      }
      note(colon[1]);
      sentence = colon[2];
    }
    const pieces = splitOutsideParens(sentence, LIST_SEP);
    // "Users log out and in to pick up the setting" / "The app is an app-store release, not a restart": no service in it, so it is ONE note
    if (!pieces.some(pieceOk)) {
      note(sentence);
      continue;
    }
    let prevWasService = false;
    for (const raw of pieces) {
      const p = trimDot(raw.replace(/^the\s+/i, ""));
      if (!p) continue;
      const outside = outsideParens(p);
      if (NEGATIVE_RE.test(p) || SENTENCE_START_RE.test(p) || /owner to confirm|^how\b|:\s{0,3}unknown/i.test(outside) || outside.trim().split(/\s+/).length > 7) {
        note(p);
        prevWasService = false;
        continue;
      }
      // "Channel Kart (code); properties need cache clear only": the phrase after a service is what is done to it
      if (prevWasService && !pieceOk(raw) && services.length) {
        const last = services[services.length - 1];
        last.note = capStr([last.note, p].filter(Boolean).join("; "), 300);
        continue;
      }
      const before = services.length;
      addService(p, "");
      prevWasService = services.length > before;
    }
  }
  return { services, notes };
}

/**
 * Lines `key   default   prod: <state>` (cells separated by 2+ blanks) of row 11. Cleanly parseable
 * lines become config rows; anything else stays in the raw row text.
 */
function configRowsOf(r: ReleaseRow): ConfigRow[] {
  const rows: ConfigRow[] = [];
  for (const line of r.lines ?? []) {
    const cells = line.trim().split(/ {2,}/);
    if (cells.length < 2 || !/^[A-Za-z][\w.:/-]{2,100}$/.test(cells[0])) continue;
    const row: ConfigRow = { key: cells[0], source: "text" };
    let labelled = false;
    for (const cell of cells.slice(1)) {
      let m: RegExpExecArray | null;
      if ((m = /^(demo|uat|prod)\s{0,2}:\s{0,2}(.{1,200})$/i.exec(cell))) {
        row[m[1].toLowerCase() as "demo" | "uat" | "prod"] = m[2].trim();
        labelled = true;
      } else if ((m = /^default\s{0,2}:?\s{0,2}(.{1,200})$/i.exec(cell))) row.default = m[1].trim();
      else if (row.default === undefined) row.default = cell.trim();
    }
    // Only lines that name an environment state ("prod: unset") are config rows.
    if (labelled && rows.length < 60) rows.push(row);
  }
  return rows;
}

/** "Reports - Chirag & Hemant; Claims - X": test owner per area. */
function testOwnersOf(text: string): Array<{ area: string | null; owner: string }> {
  const out: Array<{ area: string | null; owner: string }> = [];
  for (const seg of splitOutsideParens(text, /[;\n]\s{0,3}/)) {
    const m = /^(.{1,60}?)\s{1,3}(?:-|\u2013|\u2014|=|:)\s{1,3}(\S.{0,200})$/.exec(seg);
    if (m) out.push({ area: m[1].trim(), owner: m[2].trim() });
    else if (seg.trim()) out.push({ area: null, owner: seg.trim() });
    if (out.length >= 30) break;
  }
  return out;
}

/** Fills `facts` from the dialect where the facts have no value yet. Returns the risks it added. */
export function applyDialect(facts: RecordFacts, d: Dialect, covers: Cover[]): void {
  facts.labelled = d.labelled;
  facts.releaseRows = d.rows;
  const notDone = d.rows.filter((r) => r.state === "not_done");
  if (notDone.length) facts.notDone = notDone.map((r) => ({ n: r.n, id: r.id, label: r.label, text: r.text }));

  // PR groups other than the merged union, named but never counted
  if (d.stillOpen.length) facts.stillOpen = d.stillOpen;
  if (d.reverted.length) facts.reverted = d.reverted;
  if (d.stackOnly.length) facts.stackOnly = d.stackOnly;

  // status word and reason
  const status = labelBlock(d, /^STATUS$/i);
  if (status) {
    const line = status.text.split("\n")[0];
    const sw = /\b(HELD|PARTIAL|READY)\b/.exec(line);
    facts.statusWord = (sw ? sw[1] : null) as RecordFacts["statusWord"];
    if (sw) {
      const reason = line.slice(sw.index + sw[0].length).replace(/^[\s:\u00b7,\u2013\u2014-]{1,10}/, "").trim();
      if (reason) facts.statusReason = capStr(reason, 300);
    }
  }

  // "likely to be missed in testing": one point per line, numbered or not
  const likely = labelBlock(d, /^LIKELY TO BE MISSED$/);
  if (likely) {
    const pts = likely.lines
      .map((l, i) => {
        const m = /^\s{0,6}(\d{1,3})[.)]\s{1,3}(\S.*)$/.exec(l);
        return { n: m ? parseInt(m[1], 10) : i + 1, text: capStr(trimDot((m ? m[2] : l).replace(/^\s{0,6}[-*\u2022]\s{1,3}/, "")), 400) };
      })
      .filter((p) => p.text);
    if (pts.length) facts.likelyMissed = pts.slice(0, 30);
  }

  // test owner per area (after the rows)
  const owners = labelBlock(d, /^(test owners?(?: per area)?|owners)$/i);
  if (owners) {
    const t = owners.text.replace(/\n/g, "; ");
    facts.testOwners = /^\s*(unknown|n\/a)\b/i.test(t) || !t.trim() ? [{ area: null, owner: "unknown" }] : testOwnersOf(owners.text);
  }

  // roles (row 20): the text as written, not split into invented roles
  const roles = rowOf(d, "designations");
  if (roles && roles.text && facts.roles === undefined) facts.roles = [{ who: null, what: capStr(roles.text, 500), negative: false }];

  const what = labelBlock(d, /^WHAT$/);
  if (what && facts.summary === undefined) facts.summary = capStr(what.text.split("\n")[0], 300);

  // deploy / restart
  const deploy = rowOf(d, "services_deploy");
  if (deploy && facts.deploy === undefined && facts.deployNone === undefined) {
    if (deploy.state === "not_required" || deploy.state === "no") facts.deployNone = true;
    else {
      const r = servicesOfRow(deploy);
      if (r.services.length) facts.deploy = r.services;
      if (r.notes.length) facts.deployNotes = r.notes;
    }
  }
  const restart = rowOf(d, "services_restart");
  if (restart && facts.restart === undefined && facts.restartNone === undefined) {
    if (restart.state === "not_required" || restart.state === "no") facts.restartNone = true;
    else {
      const r = servicesOfRow(restart);
      if (r.services.length) facts.restart = r.services;
      if (r.notes.length) facts.restartNotes = r.notes;
    }
  }
  const sdk = rowOf(d, "bundle_sdk");
  if (sdk && facts.bundleSdkBuild === undefined) facts.bundleSdkBuild = sdk.state === "yes" ? "yes" : sdk.state === "no" || sdk.state === "not_required" ? "no" : "unknown";

  // app release (rows 3 / 21)
  const app = rowOf(d, "app_release");
  if (app && facts.appRelease === undefined) {
    const applicable = app.state === "not_required" || app.state === "no" ? false : app.state === "yes" || app.state === "done" ? true : null;
    facts.appRelease = { applicable, refs: [], section: app.n };
  }

  // database (rows 5 / 7 / 8 / 14)
  const dbRows = (["previous_data", "db_queries", "db_index", "ui_indexdb"] as const).map((id) => rowOf(d, id)).filter((r): r is ReleaseRow => !!r);
  if (dbRows.length && facts.database === undefined) {
    const none = (r: ReleaseRow) => r.state === "not_required" || r.state === "no" || (r.state === "done" && /^(none|nothing)\b/i.test(r.text));
    const qs = rowOf(d, "db_queries");
    const open = dbRows.filter((r) => !none(r));
    // The four release-page rows are the SINGLE source of these answers (they are merged per row, with every Jira's instruction, by the
    // checklist and the roll-up): no `items` and no "no SQL" claim are made from them a second time.
    void qs;
    facts.database = {
      noSql: false,
      hasAction: open.some((r) => r.state === "not_done" || r.state === "unknown"),
      items: [],
      sqlPaths: [],
      section: qs?.n ?? dbRows[0].n,
    };
  }

  // configs (row 11): the raw text and the identifiers in it; never turned into config rows
  const cfg = rowOf(d, "configs_prod");
  if (cfg) {
    if (cfg.state === "not_required" || cfg.state === "no") {
      if (facts.configsNone === undefined) facts.configsNone = true;
    } else {
      KEY_RE.lastIndex = 0;
      const keys = Array.from(new Set(cfg.text.match(KEY_RE) ?? [])).slice(0, 30);
      facts.configsText = { state: cfg.state, text: capStr(cfg.text, 1000), keys };
      // Lines "key   default   prod: <state>" are config rows (only when cleanly parseable).
      const rowsOfCfg = configRowsOf(cfg);
      if (rowsOfCfg.length && facts.configs === undefined) facts.configs = rowsOfCfg;
    }
  }

  // cherry-pick (row 23)
  const cp = rowOf(d, "cherry_pick");
  if (cp) {
    facts.cherryPick = { state: cp.state, text: capStr(cp.text, 1000) };
    // The prod branch is named from the section 5 catalogue: "prod branch: papa", `prod_blue_*`, hotfix/prod-base.
    const named = /\bprod(?:uction)?\s{1,3}branch\s{0,3}[:=]?\s{0,3}`?([\w./*-]{2,60})/i.exec(cp.answer);
    // A word after "prod branch" counts only when it looks like a branch name (not "is", "not").
    const okNamed = named && (/[-_./*]/.test(named[1]) || /^(papa|AAckcoe|master|main)$/i.test(named[1])) ? named : null;
    const pb = okNamed ?? /[\w./-]{0,40}\bprod[-_][\w.*-]{0,80}/i.exec(cp.answer);
    if (pb && facts.prodBranch === undefined) {
      const branch = (pb[1] ?? pb[0]).replace(/[.-]+$/, "");
      facts.prodBranch = { branch, ...(branch.includes("*") ? { isPattern: true } : {}) };
      facts.prodBranches = [branch];
    }
  }

  // order / rollback / verification
  const order = labelBlock(d, /^ORDER$/);
  if (order && facts.order === undefined) {
    const t = order.text.replace(/\n/g, " ");
    const steps: OrderStep[] = splitOutsideParens(t, /\s{0,3}(?:->|→|=>)\s{0,3}/).map((p) => {
      const s = stepFrom(p);
      return { ...s, refs: s.refs.map((r) => resolveByCovers(r, covers)) };
    });
    const real = steps.filter((s) => s.text);
    const undo = labelBlock(d, /^UNDO$/);
    facts.order = {
      steps: real,
      stepsSource: "text",
      structured: /->|→|=>/.test(t) && real.length > 1,
      edges: dedupeEdges(chainEdges(real)),
      gates: [],
      ...(undo ? { rollback: capStr(trimDot(undo.text.replace(/\n/g, " ")), 500) } : {}),
    };
  } else if (order === undefined) {
    const undo = labelBlock(d, /^UNDO$/);
    if (undo && facts.order === undefined) facts.order = { steps: [], stepsSource: "text", structured: false, edges: [], gates: [], rollback: capStr(trimDot(undo.text.replace(/\n/g, " ")), 500) };
  }
  const verify = labelBlock(d, /^VERIFY$/);
  if (verify && facts.verification === undefined) {
    const items = splitOutsideParens(verify.text.replace(/\n/g, " "), /;\s{0,3}/).map((x) => capStr(trimDot(x), 500)).filter(Boolean);
    if (items.length) facts.verification = items.slice(0, 20);
  }

  // open points and "likely to be missed" as risks of severity Note
  if (facts.risks === undefined) {
    const risks: RiskItem[] = [];
    for (const b of d.labelled) {
      if (!/^(OPEN|LIKELY TO BE MISSED|RISKS?|OPEN ITEMS|NOTES?)$/.test(b.label)) continue;
      for (const l of b.lines) {
        const t = trimDot(l.replace(/^\s{0,6}(?:[-*•]|\d{1,3}[.)])\s{1,3}/, ""));
        if (t && risks.length < 40) risks.push({ severity: "Note", text: capStr(t, 400), source: "text" });
      }
    }
    if (risks.length) facts.risks = risks;
  }
}
