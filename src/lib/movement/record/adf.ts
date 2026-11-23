/**
 * Structure-preserving reader for Jira comment bodies.
 *
 * `src/lib/jira/adf.ts#adfToText` flattens everything into one string, which loses the bold
 * section headings and the table cells the record parser needs. This module turns an ADF
 * document (or markdown-ish text) into a compact block list instead:
 *   paragraph/heading with inline runs (bold, code, link), list items, tables as rows of cell
 *   text, code blocks. A hardBreak becomes "\n" inside the run text.
 *
 * Bounds (all enforced BEFORE building, never after): recursion depth <= 40, <= 4000 blocks,
 * <= 64K characters in total, <= 20K characters and <= 2000 runs per paragraph, words <= 200
 * characters, whitespace runs <= 8. Beyond that the rest is dropped and `truncated` is set.
 */
import { canonicalByTitle } from "./sections";
import type { Block, BlockList, Run } from "./types";
import { cleanText } from "./util";

export const MAX_DEPTH = 40;
export const MAX_BLOCKS = 4000;
export const MAX_CHARS = 64_000;
export const MAX_PARA_CHARS = 20_000;
export const MAX_PARA_RUNS = 2000;
export const MAX_CODE_CHARS = 60_000;
const MAX_CELL_CHARS = 500;
const MAX_CELLS = 40;
const MAX_ROWS = 500;
/** One text node/line is cut to this before sanitising so a 100 MB node costs bounded CPU. */
const MAX_RAW = 200_000;
const RUN_BLANKS = 8;

interface AdfNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: unknown;
  content?: unknown;
}

class Budget {
  blocks = 0;
  chars = 0;
  truncated = false;
  room(): number {
    return Math.max(0, MAX_CHARS - this.chars);
  }
  /** Spend up to `n` characters; returns how many were granted. */
  spend(n: number): number {
    const g = Math.min(n, this.room());
    if (g < n) this.truncated = true;
    this.chars += g;
    return g;
  }
  /** Register a block; false when the block limit is reached. */
  block(): boolean {
    if (this.blocks >= MAX_BLOCKS) {
      this.truncated = true;
      return false;
    }
    this.blocks++;
    return true;
  }
}

/** Per-paragraph limits, checked while the runs are built. */
interface Para {
  chars: number;
  max: number;
  /** Code blocks keep their text as is (only clipped): JSON strings may hold long words. */
  raw?: boolean;
}

function isNode(v: unknown): v is AdfNode {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Children as an array, whatever the (possibly malformed) `content` holds. */
function kids(n: AdfNode): unknown[] {
  return Array.isArray(n.content) ? n.content : [];
}

/** Merge neighbouring runs that carry the same flags. */
function pushRun(runs: Run[], run: Run): void {
  if (!run.text) return;
  const last = runs[runs.length - 1];
  if (last && !!last.bold === !!run.bold && !!last.code === !!run.code && last.href === run.href) {
    last.text += run.text;
  } else {
    runs.push(run);
  }
}

function addText(runs: Run[], text: string, flags: Omit<Run, "text">, depthOk: boolean, budget: Budget, para: Para): void {
  if (!depthOk) return;
  if (runs.length >= MAX_PARA_RUNS) {
    budget.truncated = true;
    return;
  }
  const clipped = text.length > MAX_RAW ? text.slice(0, MAX_RAW) : text;
  let t = para.raw ? clipped : cleanText(clipped, RUN_BLANKS);
  if (!t) return;
  const room = Math.min(para.max - para.chars, budget.room());
  if (room <= 0) {
    budget.truncated = true;
    return;
  }
  if (t.length > room) {
    t = t.slice(0, room);
    budget.truncated = true;
  }
  para.chars += budget.spend(t.length);
  pushRun(runs, { text: t, ...flags });
}

function inlineRuns(node: AdfNode, depth: number, runs: Run[], budget: Budget, para: Para): void {
  if (depth > MAX_DEPTH) {
    budget.truncated = true;
    return;
  }
  switch (node.type) {
    case "text": {
      if (typeof node.text !== "string") return;
      const flags: Omit<Run, "text"> = {};
      if (Array.isArray(node.marks)) {
        for (const m of node.marks as unknown[]) {
          if (!isNode(m)) continue;
          const mm = m as { type?: string; attrs?: Record<string, unknown> };
          if (mm.type === "strong") flags.bold = true;
          else if (mm.type === "code") flags.code = true;
          else if (mm.type === "link" && typeof mm.attrs?.href === "string") flags.href = mm.attrs.href.slice(0, 500);
        }
      }
      addText(runs, node.text, flags, true, budget, para);
      return;
    }
    case "hardBreak":
      addText(runs, "\n", {}, true, budget, para);
      return;
    case "mention":
    case "emoji":
    case "status":
    case "date": {
      const t = node.attrs?.text ?? node.attrs?.shortName ?? node.attrs?.timestamp;
      if (typeof t === "string") addText(runs, t, {}, true, budget, para);
      return;
    }
    case "inlineCard": {
      const url = node.attrs?.url;
      if (typeof url === "string") addText(runs, url, { href: url.slice(0, 500) }, true, budget, para);
      return;
    }
    default:
      for (const c of kids(node)) {
        if (runs.length >= MAX_PARA_RUNS || para.chars >= para.max) {
          budget.truncated = true;
          break;
        }
        if (isNode(c)) inlineRuns(c, depth + 1, runs, budget, para);
      }
  }
}

function runsOf(node: AdfNode, depth: number, budget: Budget, max = MAX_PARA_CHARS, raw = false): Run[] {
  const runs: Run[] = [];
  inlineRuns(node, depth, runs, budget, { chars: 0, max, raw });
  return runs;
}

const flat = (s: string): string =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .join(" ");

function cellText(cell: AdfNode, depth: number, budget: Budget): string {
  // Several paragraphs/lists in one cell are joined with a space; a hard break is a space too.
  const parts: string[] = [];
  for (const c of kids(cell)) {
    if (!isNode(c)) continue;
    const t = flat(
      runsOf(c, depth + 1, budget, MAX_CELL_CHARS)
        .map((r) => r.text)
        .join(""),
    );
    if (t) parts.push(t);
    if (parts.length >= 10) break;
  }
  return parts.join(" ").slice(0, MAX_CELL_CHARS);
}

interface ListCtx {
  ordered: boolean;
  depth: number;
  counter: { n: number };
}

function walkBlocks(node: AdfNode, depth: number, out: Block[], budget: Budget, list?: ListCtx): void {
  if (depth > MAX_DEPTH) {
    budget.truncated = true;
    return;
  }
  if (budget.blocks >= MAX_BLOCKS) {
    budget.truncated = true;
    return;
  }
  switch (node.type) {
    case "paragraph": {
      const runs = runsOf(node, depth + 1, budget);
      if (runs.length && budget.block()) out.push({ kind: "paragraph", runs });
      return;
    }
    case "heading": {
      const runs = runsOf(node, depth + 1, budget);
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
      if (runs.length && budget.block()) out.push({ kind: "heading", level, runs });
      return;
    }
    case "codeBlock": {
      const runs = runsOf(node, depth + 1, budget, MAX_CODE_CHARS, true);
      const text = runs.map((r) => r.text).join("");
      if (text && budget.block()) out.push({ kind: "code", text });
      return;
    }
    case "bulletList":
    case "orderedList": {
      const ordered = node.type === "orderedList";
      const ctx: ListCtx = { ordered, depth: list ? list.depth + 1 : 0, counter: { n: 0 } };
      for (const li of kids(node)) {
        // Budget spent: stop at once (a 200 000-item list costs one check, not 200 000 walks).
        if (budget.blocks >= MAX_BLOCKS || budget.room() === 0) {
          budget.truncated = true;
          break;
        }
        if (isNode(li)) walkBlocks(li, depth + 1, out, budget, ctx);
      }
      return;
    }
    case "listItem": {
      const ctx = list ?? { ordered: false, depth: 0, counter: { n: 0 } };
      ctx.counter.n++;
      // The item's own inline text is its first paragraph(s); nested lists become deeper items.
      const runs: Run[] = [];
      const para: Para = { chars: 0, max: MAX_PARA_CHARS };
      const nested: AdfNode[] = [];
      for (const c of kids(node)) {
        if (!isNode(c)) continue;
        if (c.type === "bulletList" || c.type === "orderedList") nested.push(c);
        else {
          if (runs.length) addText(runs, " ", {}, true, budget, para);
          inlineRuns(c, depth + 1, runs, budget, para);
        }
      }
      if (runs.length && budget.block()) {
        out.push({
          kind: "listItem",
          ordered: ctx.ordered,
          depth: ctx.depth,
          ...(ctx.ordered ? { index: ctx.counter.n } : {}),
          runs,
        });
      }
      for (const n of nested) walkBlocks(n, depth + 1, out, budget, ctx);
      return;
    }
    case "table": {
      const rows: string[][] = [];
      let header = false;
      for (const tr of kids(node)) {
        if (!isNode(tr) || tr.type !== "tableRow") continue;
        const cells = kids(tr).filter(isNode);
        if (rows.length === 0 && cells.length > 0 && cells.every((c) => c.type === "tableHeader")) header = true;
        if (cells.length > MAX_CELLS) budget.truncated = true;
        const row: string[] = [];
        for (const c of cells.slice(0, MAX_CELLS)) {
          const t = cellText(c, depth + 3, budget);
          row.push(t);
        }
        rows.push(row);
        if (rows.length >= MAX_ROWS) {
          budget.truncated = true;
          break;
        }
        if (budget.room() === 0) break;
      }
      if (rows.length && budget.block()) out.push({ kind: "table", header, rows });
      return;
    }
    case "rule":
    case "media":
    case "mediaSingle":
    case "mediaGroup":
      return;
    default:
      // doc, blockquote, panel, expand, unknown wrappers: look through them.
      for (const c of kids(node)) if (isNode(c)) walkBlocks(c, depth + 1, out, budget, list);
  }
}

/**
 * ADF document -> block list. Never throws on odd input: a malformed document degrades to what
 * could be read, and when nothing can be, to its leading text (so the marker is still found).
 */
export function adfToBlocks(doc: unknown): BlockList {
  const out: Block[] = [];
  const budget = new Budget();
  try {
    if (isNode(doc)) walkBlocks(doc, 0, out, budget);
  } catch {
    budget.truncated = true;
  }
  if (out.length === 0 && budget.truncated) {
    const head = adfHeadText(doc);
    if (head) out.push({ kind: "paragraph", runs: [{ text: head }] });
  }
  return { blocks: out, truncated: budget.truncated };
}

// ---------------------------------------------------------------------------------------------
// Markdown-ish text -> the same blocks
// ---------------------------------------------------------------------------------------------

const TABLE_SEP = /^\|?\s{0,8}:?-{2,}:?\s{0,8}(\|\s{0,8}:?-{2,}:?\s{0,8}){0,40}\|?$/;
const SECTION_LINE = /^\s{0,8}\*\*\d{1,2}[.)]?\s{1,8}[^*\n]{1,120}\*\*/;
const PLAIN_SECTION_LINE = /^\s{0,8}(\d{1,2})[.)]?\s{1,8}([A-Za-z][^:\n]{0,80}):/;

function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length && cells.length < MAX_CELLS; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cells.length < MAX_CELLS) cells.push(cur);
  return cells.map((c) => flat(runsToPlain(parseInline(c.slice(0, MAX_CELL_CHARS), 0))));
}

/** Inline markdown: **bold**, `code`, [text](url). Italics are left as plain text. */
export function parseInline(s: string, depth: number): Run[] {
  const runs: Run[] = [];
  const re = /\*\*([^*\n]{1,500})\*\*|`([^`\n]{1,500})`|\[([^\]\n]{1,300})\]\((https?:[^)\s]{1,500})\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null && runs.length < MAX_PARA_RUNS) {
    if (m.index > last) pushRun(runs, { text: s.slice(last, m.index) });
    if (m[1] !== undefined) {
      if (depth < 3) {
        for (const r of parseInline(m[1], depth + 1)) pushRun(runs, { ...r, bold: true });
      } else pushRun(runs, { text: m[1], bold: true });
    } else if (m[2] !== undefined) pushRun(runs, { text: m[2], code: true });
    else pushRun(runs, { text: m[3], href: m[4] });
    last = m.index + m[0].length;
  }
  if (last < s.length) pushRun(runs, { text: s.slice(last) });
  return runs;
}

export function runsToPlain(runs: Run[]): string {
  return runs.map((r) => r.text).join("");
}

/** True when a plain line is an unbolded `N Title:` heading of a known template section. */
function plainSectionLine(l: string): boolean {
  const m = PLAIN_SECTION_LINE.exec(l);
  return !!m && canonicalByTitle(m[2]) !== null;
}

/** Markdown-ish text -> blocks. Accepts `**N Title:**` section paragraphs, `|` tables, fences. */
export function markdownToBlocks(text: string): BlockList {
  const out: Block[] = [];
  const budget = new Budget();
  // Fullwidth/odd asterisks become `*`; outside code fences runs of blanks are capped and long
  // words cut (fence content is kept as is: JSON strings may hold long words); size is cut.
  const rawText = text.length > MAX_RAW ? text.slice(0, MAX_RAW) : text;
  if (text.length > MAX_RAW) budget.truncated = true;
  const lines: string[] = [];
  let inFence = false;
  let total = 0;
  for (const raw of rawText.replace(/[\uFF0A\u2217\u204E\u066D]/g, "*").split("\n")) {
    const isFence = /^\s{0,8}```/.test(raw);
    const line = inFence && !isFence ? raw.slice(0, MAX_CODE_CHARS) : cleanText(raw, RUN_BLANKS);
    if (isFence) inFence = !inFence;
    total += line.length + 1;
    if (total > MAX_CHARS) {
      // Keep what still fits of this line (a heading line must not vanish because it is long).
      budget.truncated = true;
      lines.push(line.slice(0, Math.max(0, MAX_CHARS - (total - line.length - 1))));
      break;
    }
    lines.push(line);
  }
  let i = 0;
  const isBlockStart = (l: string) =>
    /^\s{0,8}(```|#{1,6}\s|\|)/.test(l) || /^\s{0,8}([-*+]|\d{1,3}[.)])\s/.test(l) || SECTION_LINE.test(l) || plainSectionLine(l);

  while (i < lines.length && budget.blocks < MAX_BLOCKS) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s{0,8}```/.test(line)) {
      const buf: string[] = [];
      let n = 0;
      i++;
      while (i < lines.length && !/^\s{0,8}```/.test(lines[i])) {
        if (n < MAX_CODE_CHARS) buf.push(lines[i]);
        n += lines[i].length + 1;
        i++;
      }
      i++; // closing fence
      let code = buf.join("\n");
      if (code.length > MAX_CODE_CHARS) {
        code = code.slice(0, MAX_CODE_CHARS);
        budget.truncated = true;
      }
      if (code && budget.block()) out.push({ kind: "code", text: code });
      continue;
    }
    if (/^\s{0,8}\|/.test(line)) {
      const rows: string[][] = [];
      let header = false;
      while (i < lines.length && /^\s{0,8}\|/.test(lines[i])) {
        if (rows.length >= MAX_ROWS) {
          budget.truncated = true;
        } else if (TABLE_SEP.test(lines[i].trim())) {
          if (rows.length === 1) header = true;
        } else rows.push(splitCells(lines[i]));
        i++;
      }
      if (rows.length && budget.block()) out.push({ kind: "table", header, rows });
      continue;
    }
    const h = /^\s{0,8}(#{1,6})\s{1,8}(.*)$/.exec(line);
    if (h) {
      const runs = parseInline(h[2], 0);
      if (runs.length && budget.block()) out.push({ kind: "heading", level: h[1].length, runs });
      i++;
      continue;
    }
    const li = /^(\s{0,40})([-*+]|\d{1,3}[.)])\s{1,8}(.*)$/.exec(line);
    if (li && !SECTION_LINE.test(line)) {
      const ordered = /\d/.test(li[2]);
      const runs = parseInline(li[3], 0);
      if (budget.block()) {
        out.push({
          kind: "listItem",
          ordered,
          depth: Math.floor(li[1].length / 2),
          ...(ordered ? { index: parseInt(li[2], 10) } : {}),
          runs,
        });
      }
      i++;
      continue;
    }
    // Paragraph: consecutive non-blank lines, joined with "\n" (== ADF hardBreak/newline text).
    const buf = [line];
    let n = line.length;
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      if (n < MAX_PARA_CHARS) buf.push(lines[i]);
      else budget.truncated = true;
      n += lines[i].length + 1;
      i++;
    }
    let joined = buf.join("\n");
    if (joined.length > MAX_PARA_CHARS) {
      joined = joined.slice(0, MAX_PARA_CHARS);
      budget.truncated = true;
    }
    const runs = parseInline(joined, 0);
    if (runs.length && budget.block()) out.push({ kind: "paragraph", runs });
  }
  if (i < lines.length) budget.truncated = true;
  return { blocks: out, truncated: budget.truncated };
}

/**
 * Block list -> plain lines (no markdown marks): paragraphs and headings as their text, list
 * items with their "- " / "1. " prefix and indentation, table rows as `a | b`, code as is. Used
 * to read a free-form record whose layout matters (label lines, numbered rows).
 */
export function blocksToText(blocks: Block[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case "paragraph":
      case "heading":
        lines.push(runsToPlain(b.runs));
        break;
      case "listItem":
        lines.push(" ".repeat(Math.min(b.depth, 5) * 2) + (b.ordered ? `${b.index ?? 1}. ` : "- ") + runsToPlain(b.runs));
        break;
      case "table":
        for (const r of b.rows) lines.push(r.join(" | "));
        break;
      case "code":
        lines.push(b.text);
        break;
    }
  }
  return lines.join("\n");
}

/** Block list -> markdown-ish text that `markdownToBlocks` reads back to the same blocks. */
export function blocksToMarkdown(blocks: Block[]): string {
  const runMd = (runs: Run[]) =>
    runs
      .map((r) => {
        let t = r.text;
        if (r.code) t = "`" + t + "`";
        if (r.bold) t = "**" + t + "**";
        if (r.href && !r.code) t = `[${t}](${r.href})`;
        return t;
      })
      .join("");
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case "paragraph":
        parts.push(runMd(b.runs));
        break;
      case "heading":
        parts.push("#".repeat(Math.min(6, Math.max(1, b.level))) + " " + runMd(b.runs));
        break;
      case "listItem":
        parts.push(" ".repeat(b.depth * 2) + (b.ordered ? `${b.index ?? 1}. ` : "- ") + runMd(b.runs));
        break;
      case "table": {
        const esc = (c: string) => c.replace(/\|/g, "\\|");
        const lines = b.rows.map((r) => "| " + r.map(esc).join(" | ") + " |");
        if (b.header && lines.length > 0) {
          lines.splice(1, 0, "| " + b.rows[0].map(() => "---").join(" | ") + " |");
        }
        parts.push(lines.join("\n"));
        break;
      }
      case "code":
        parts.push("```\n" + b.text + "\n```");
        break;
    }
  }
  // List items of one list stay on consecutive lines (no blank line between them).
  let md = "";
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) md += blocks[i].kind === "listItem" && blocks[i - 1].kind === "listItem" ? "\n" : "\n\n";
    md += parts[i];
  }
  return md;
}

// ---------------------------------------------------------------------------------------------
// Cheap detection: look at the first text node(s) only
// ---------------------------------------------------------------------------------------------

const HEAD_CHARS = 300;
/** Safety bound on visited nodes while peeking (the peek is capped by characters, not nodes). */
const HEAD_VISITS = 400;

/**
 * The first ~300 characters of an ADF document, read by walking only the first child chain
 * (iteratively, depth-bounded). Never visits the rest of the document, so a 2 MB comment costs
 * the same as a 2 KB one. A document that starts inside a blockquote is returned with a leading
 * "> " (a quoted reply, not a record).
 */
export function adfHeadText(doc: unknown): string {
  if (!isNode(doc)) return "";
  let text = "";
  let visits = 0;
  let quoted = false;
  const stack: Array<{ node: AdfNode; i: number }> = [{ node: doc, i: 0 }];
  while (stack.length > 0 && text.length < HEAD_CHARS && visits++ < HEAD_VISITS) {
    const top = stack[stack.length - 1];
    if (top.node.type === "text" && typeof top.node.text === "string") {
      text += top.node.text;
      stack.pop();
      continue;
    }
    if (top.node.type === "hardBreak") {
      text += "\n";
      stack.pop();
      continue;
    }
    if (top.node.type === "blockquote" && text.length === 0) quoted = true;
    const kidsList = kids(top.node);
    if (top.i >= kidsList.length || stack.length > MAX_DEPTH) {
      stack.pop();
      continue;
    }
    const child = kidsList[top.i++];
    if (isNode(child)) stack.push({ node: child, i: 0 });
  }
  return (quoted ? "> " : "") + text.slice(0, HEAD_CHARS);
}

/**
 * Leading text of any accepted body: ADF object, ADF JSON string (peeked by regex, not parsed),
 * or markdown/plain text.
 */
export function bodyHeadText(body: unknown): string {
  if (typeof body === "string") {
    const s = body.length > 4096 ? body.slice(0, 4096) : body;
    const trimmed = s.trimStart();
    if (trimmed.startsWith("{")) {
      // ADF as JSON text: the first "text":"..." value, without parsing the whole document.
      const m = /"text"\s{0,4}:\s{0,4}"/.exec(trimmed);
      if (!m) return "";
      const quoted = /"type"\s{0,4}:\s{0,4}"blockquote"/.test(trimmed.slice(0, m.index));
      // Read the string value character by character (whatever its length), unescaping as we go,
      // and stop after HEAD_CHARS characters: the closing quote may be far away.
      let out = "";
      for (let i = m.index + m[0].length; i < trimmed.length && out.length < HEAD_CHARS; i++) {
        const ch = trimmed[i];
        if (ch === '"') break;
        if (ch === "\\") {
          const n = trimmed[++i];
          if (n === "n") out += "\n";
          else if (n === "t") out += "\t";
          else if (n === "u") {
            const code = parseInt(trimmed.slice(i + 1, i + 5), 16);
            if (!Number.isNaN(code)) out += String.fromCharCode(code);
            i += 4;
          } else if (n !== undefined) out += n;
        } else out += ch;
      }
      return (quoted ? "> " : "") + out;
    }
    return trimmed.slice(0, HEAD_CHARS);
  }
  return adfHeadText(body);
}

/** Turn any accepted body into blocks (parses an ADF JSON string, else treats text as markdown). */
export function bodyToBlocks(body: unknown): BlockList {
  if (typeof body === "string") {
    const t = body.trimStart();
    if (t.startsWith("{") && body.length <= MAX_RAW * 4) {
      try {
        const parsed = JSON.parse(body) as unknown;
        if (isNode(parsed) && parsed.type === "doc") return adfToBlocks(parsed);
      } catch {
        /* fall through: treat as text */
      }
    }
    return markdownToBlocks(body);
  }
  return adfToBlocks(body);
}
