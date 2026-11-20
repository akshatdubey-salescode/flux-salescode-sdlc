// Pure text edits behind the MarkdownEditor toolbar. Each takes the current
// value and selection and returns the new value and selection.

export type Edit = { value: string; selStart: number; selEnd: number };

export type FormatAction = "bold" | "italic" | "heading" | "link" | "code" | "list";

function wrap(v: string, s: number, e: number, before: string, after: string, placeholder: string): Edit {
  const selected = v.slice(s, e) || placeholder;
  const value = v.slice(0, s) + before + selected + after + v.slice(e);
  return { value, selStart: s + before.length, selEnd: s + before.length + selected.length };
}

/** Applies `prefix` to the start of every line touched by the selection. */
function prefixLines(v: string, s: number, e: number, prefix: string): Edit {
  const lineStart = v.lastIndexOf("\n", s - 1) + 1;
  const block = v.slice(lineStart, e);
  const lines = block.split("\n");
  const allPrefixed = lines.every((l) => l.startsWith(prefix));
  const next = lines.map((l) => (allPrefixed ? l.slice(prefix.length) : prefix + l)).join("\n");
  const value = v.slice(0, lineStart) + next + v.slice(e);
  return { value, selStart: lineStart, selEnd: lineStart + next.length };
}

export function applyFormat(action: FormatAction, v: string, s: number, e: number): Edit {
  switch (action) {
    case "bold":
      return wrap(v, s, e, "**", "**", "bold text");
    case "italic":
      return wrap(v, s, e, "_", "_", "italic text");
    case "heading":
      return prefixLines(v, s, e, "## ");
    case "list":
      return prefixLines(v, s, e, "- ");
    case "code": {
      const selected = v.slice(s, e);
      return selected.includes("\n")
        ? wrap(v, s, e, "```\n", "\n```", "code")
        : wrap(v, s, e, "`", "`", "code");
    }
    case "link": {
      const text = v.slice(s, e) || "link text";
      const insert = `[${text}](https://)`;
      const value = v.slice(0, s) + insert + v.slice(e);
      const urlStart = s + text.length + 3;
      return { value, selStart: urlStart, selEnd: urlStart + "https://".length };
    }
  }
}

/** Inserts `text` at the cursor (replacing any selection), on its own line(s). */
export function insertBlock(v: string, s: number, e: number, text: string): Edit {
  const before = v.slice(0, s);
  const after = v.slice(e);
  const lead = before === "" || before.endsWith("\n") ? "" : "\n";
  const trail = after === "" || after.startsWith("\n") ? "" : "\n";
  const value = before + lead + text + trail + after;
  const pos = before.length + lead.length + text.length;
  return { value, selStart: pos, selEnd: pos };
}

/** Markdown for an uploaded image; brackets in the alt text are stripped. */
export function imageMarkdown(alt: string, url: string): string {
  const clean = alt.replace(/\.[a-z0-9]+$/i, "").replace(/[[\]\n]/g, " ").trim() || "image";
  return `![${clean}](${url})`;
}
