// Heuristic, patch-only comment stripping — counts a PR's added/removed LOC
// excluding whole-line comments, without fetching full file content. Trades
// some accuracy for cost: a diff hunk can open partway through an
// already-started multi-line block comment without showing where it began,
// so the first line or two of such a hunk can be misclassified as code. LOC
// here is an advisory signal (never scored directly — see
// complexity-loc-thresholds.ts), so this bounded imprecision is an accepted
// trade against the much higher API cost of fetching full base+head file
// content to resolve comment state exactly.
//
// Only whole-line comments are stripped (a line that IS a comment, start to
// end). A trailing inline comment on a code line (`doThing(); // note`) is
// left counted as code — splitting code from a same-line trailing comment
// reliably needs a real per-language tokenizer, which is exactly the
// full-fidelity option this heuristic was chosen over. The mirror case (a
// block comment that closes mid-line with real code following, e.g.
// `/* TODO */ doThing();`) is handled: the line counts as code, not comment,
// once anything follows the close marker.

type CommentStyle = {
  lineTokens: string[];
  blockStart?: string;
  blockEnd?: string;
  // Prefixes that look like a lineTokens match but aren't a comment in this
  // language — checked before the lineTokens match wins. Currently only PHP
  // needs this (`#[Attribute]` vs a bare `#` comment).
  lineExceptions?: string[];
};

const C_STYLE: CommentStyle = { lineTokens: ["//"], blockStart: "/*", blockEnd: "*/" };
const HASH_STYLE: CommentStyle = { lineTokens: ["#"] };
const SQL_STYLE: CommentStyle = { lineTokens: ["--"], blockStart: "/*", blockEnd: "*/" };
const HTML_STYLE: CommentStyle = { lineTokens: [], blockStart: "<!--", blockEnd: "-->" };
const CSS_STYLE: CommentStyle = { lineTokens: [], blockStart: "/*", blockEnd: "*/" };
// PHP 8+ attributes (`#[Route(...)]`) start with `#[`, not a `#` comment —
// PHP's own lexer treats the two differently, so a bare `#` exception list
// keeps attribute lines from being misclassified as comments.
const PHP_STYLE: CommentStyle = {
  lineTokens: ["//", "#"],
  blockStart: "/*",
  blockEnd: "*/",
  lineExceptions: ["#["],
};
const LUA_STYLE: CommentStyle = { lineTokens: ["--"], blockStart: "--[[", blockEnd: "]]" };

// File extension (lower-cased, no dot) → comment style. Unmapped extensions
// fall back to "don't strip anything" (see styleForFile) rather than guessing.
const STYLE_BY_EXT: Record<string, CommentStyle> = {
  ts: C_STYLE, tsx: C_STYLE, js: C_STYLE, jsx: C_STYLE, mjs: C_STYLE, cjs: C_STYLE,
  java: C_STYLE, kt: C_STYLE, kts: C_STYLE, scala: C_STYLE, go: C_STYLE, swift: C_STYLE,
  c: C_STYLE, h: C_STYLE, cc: C_STYLE, cpp: C_STYLE, hpp: C_STYLE, cs: C_STYLE, rs: C_STYLE,
  dart: C_STYLE, groovy: C_STYLE,
  py: HASH_STYLE, rb: HASH_STYLE, sh: HASH_STYLE, bash: HASH_STYLE, zsh: HASH_STYLE,
  yml: HASH_STYLE, yaml: HASH_STYLE, pl: HASH_STYLE, r: HASH_STYLE, toml: HASH_STYLE,
  sql: SQL_STYLE,
  html: HTML_STYLE, htm: HTML_STYLE, xml: HTML_STYLE, vue: HTML_STYLE, svelte: HTML_STYLE,
  css: CSS_STYLE,
  scss: C_STYLE, less: C_STYLE,
  php: PHP_STYLE,
  lua: LUA_STYLE,
};

function styleForFile(filename: string): CommentStyle | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? (STYLE_BY_EXT[ext] ?? null) : null;
}

/**
 * True when `content` (a patch line with its +/-/space marker already
 * stripped) is a whole-line comment under `style`, given whether we're
 * already inside a still-open block comment. Mutates nothing — callers track
 * the running "in block comment" flag themselves (see countPatchCodeLines).
 */
function classifyLine(
  content: string,
  style: CommentStyle,
  inBlockComment: boolean
): { isComment: boolean; nextInBlockComment: boolean } {
  const trimmed = content.trim();

  if (inBlockComment) {
    if (!style.blockEnd) return { isComment: true, nextInBlockComment: true };
    const endIdx = trimmed.indexOf(style.blockEnd);
    if (endIdx === -1) return { isComment: true, nextInBlockComment: true };
    // Block closes on this line — if real content follows the close marker,
    // count the whole line as code rather than discarding it, consistent
    // with how a trailing "// note" on a code line is already left as code.
    const trailing = trimmed.slice(endIdx + style.blockEnd.length).trim();
    return trailing === ""
      ? { isComment: true, nextInBlockComment: false }
      : { isComment: false, nextInBlockComment: false };
  }

  if (trimmed === "") return { isComment: false, nextInBlockComment: false };

  // Block-start checked before lineTokens: for Lua, the line token "--" is a
  // literal prefix of the block-start "--[[", so checking lineTokens first
  // would always misclassify a block-open as a line comment and never track
  // block state at all.
  if (style.blockStart && trimmed.startsWith(style.blockStart)) {
    if (!style.blockEnd) return { isComment: true, nextInBlockComment: true };
    const endIdx = trimmed.indexOf(style.blockEnd, style.blockStart.length);
    if (endIdx === -1) return { isComment: true, nextInBlockComment: true };
    const trailing = trimmed.slice(endIdx + style.blockEnd.length).trim();
    return trailing === ""
      ? { isComment: true, nextInBlockComment: false }
      : { isComment: false, nextInBlockComment: false };
  }

  const isException = style.lineExceptions?.some((e) => trimmed.startsWith(e)) ?? false;
  if (!isException && style.lineTokens.some((t) => trimmed.startsWith(t))) {
    return { isComment: true, nextInBlockComment: false };
  }

  return { isComment: false, nextInBlockComment: false };
}

/**
 * Code-only (comments excluded) added/removed line counts for one file's
 * unified-diff patch. Block-comment state is carried sequentially through the
 * whole patch (context, added, and removed lines all update it) and does NOT
 * reset between hunks — a deliberate simplification; see the module header
 * for its known limitation.
 */
export function countPatchCodeLines(
  filename: string,
  patch: string
): { additions: number; deletions: number } {
  const style = styleForFile(filename);
  let additions = 0;
  let deletions = 0;
  let inBlockComment = false;

  for (const line of patch.split("\n")) {
    if (line.startsWith("@@") || line.startsWith("+++") || line.startsWith("---") || line.startsWith("\\")) {
      continue;
    }
    const marker = line[0];
    if (marker !== "+" && marker !== "-" && marker !== " ") continue;
    const content = line.slice(1);

    // No known comment style for this extension — count every changed line
    // as code rather than guessing at a syntax we don't recognize.
    if (!style) {
      if (marker === "+") additions++;
      else if (marker === "-") deletions++;
      continue;
    }

    const { isComment, nextInBlockComment } = classifyLine(content, style, inBlockComment);
    inBlockComment = nextInBlockComment;

    if (isComment) continue;
    if (marker === "+") additions++;
    else if (marker === "-") deletions++;
  }

  return { additions, deletions };
}
