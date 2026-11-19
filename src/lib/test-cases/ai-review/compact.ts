// Shrinks a page's text before it goes to the AI review, without changing what it says: blank and decorative lines,
// empty table cells, diagram styling directives, repeated lines and padding are dropped. Idempotent, so it can be
// applied to text that was saved earlier.

const DECORATION = /^[\s|\-=_*~#.•·–—]{3,}$/;
// Mermaid presentation only (colours, line styles); the nodes and edges stay.
const DIAGRAM_STYLING = /^(?:classDef\s|linkStyle\s|style\s+[\w-]+\s+\S+[:=]|class\s+[\w,-]+\s+[\w-]+$|%%)/;

/** Lines that are only separators ("-----", "| | |", "=====") carry nothing; "# " style headings are kept. */
function isDecoration(line: string): boolean {
  return DECORATION.test(line) && !/^#{1,6}\s+\S/.test(line);
}

export function compactText(text: string): string {
  const out: string[] = [];
  let previous = "";
  for (const raw of text.split("\n")) {
    let line = raw.replace(/[ \t ]+/g, " ").trim();
    // Table rows: "a | | b" (an empty cell) becomes "a | b". "a || b" (an operator) is left alone.
    line = line.replace(/ \|(?: +\|)+ /g, " | ");
    if (line === "" || line === "-" || isDecoration(line) || DIAGRAM_STYLING.test(line)) continue;
    if (line === previous) continue; // the same line twice in a row
    previous = line;
    // One blank line before a heading keeps the structure readable; nothing else needs spacing.
    if (/^#{1,6}\s/.test(line) && out.length > 0) out.push("");
    out.push(line);
  }
  return out.join("\n");
}
