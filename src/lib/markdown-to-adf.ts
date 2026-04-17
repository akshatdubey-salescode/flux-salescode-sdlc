// Converts Markdown to Atlassian Document Format (ADF) for Jira REST API v3.

type AdfMark = { type: string; attrs?: Record<string, unknown> };
type AdfNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  marks?: AdfMark[];
  text?: string;
};

// ─── Inline parser ────────────────────────────────────────────────────────────

function parseInline(text: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  let s = text;

  while (s.length > 0) {
    // Bold+Italic: ***text***
    let m = s.match(/^\*\*\*([^*]+)\*\*\*/);
    if (m) {
      nodes.push({ type: "text", text: m[1], marks: [{ type: "strong" }, { type: "em" }] });
      s = s.slice(m[0].length);
      continue;
    }
    // Bold: **text**
    m = s.match(/^\*\*(.+?)\*\*/);
    if (m) {
      nodes.push({ type: "text", text: m[1], marks: [{ type: "strong" }] });
      s = s.slice(m[0].length);
      continue;
    }
    // Strikethrough: ~~text~~
    m = s.match(/^~~(.+?)~~/);
    if (m) {
      nodes.push({ type: "text", text: m[1], marks: [{ type: "strike" }] });
      s = s.slice(m[0].length);
      continue;
    }
    // Italic: *text* or _text_
    m = s.match(/^\*([^*]+)\*/) ?? s.match(/^_([^_]+)_/);
    if (m) {
      nodes.push({ type: "text", text: m[1], marks: [{ type: "em" }] });
      s = s.slice(m[0].length);
      continue;
    }
    // Inline code: `text`
    m = s.match(/^`([^`]+)`/);
    if (m) {
      nodes.push({ type: "text", text: m[1], marks: [{ type: "code" }] });
      s = s.slice(m[0].length);
      continue;
    }
    // Link: [text](url)
    m = s.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (m) {
      nodes.push({
        type: "text",
        text: m[1],
        marks: [{ type: "link", attrs: { href: m[2] } }],
      });
      s = s.slice(m[0].length);
      continue;
    }
    // Plain text up to next potential marker
    const next = s.search(/[\*_`\[~]/);
    if (next === -1) {
      nodes.push({ type: "text", text: s });
      break;
    }
    if (next === 0) {
      // Marker didn't match any pattern — consume one char as plain text
      nodes.push({ type: "text", text: s[0] });
      s = s.slice(1);
    } else {
      nodes.push({ type: "text", text: s.slice(0, next) });
      s = s.slice(next);
    }
  }

  return nodes.length > 0 ? nodes : [{ type: "text", text: text }];
}

// ─── Block parser ─────────────────────────────────────────────────────────────

export function markdownToAdf(markdown: string): object {
  const lines = markdown.split("\n");
  const content: AdfNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim() || null;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // consume closing ```
      content.push({
        type: "codeBlock",
        attrs: { language: lang },
        content: [{ type: "text", text: codeLines.join("\n") }],
      });
      continue;
    }

    // Heading
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      content.push({
        type: "heading",
        attrs: { level: hMatch[1].length },
        content: parseInline(hMatch[2].trim()),
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (line.match(/^[-*_]{3,}\s*$/)) {
      content.push({ type: "rule" });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      content.push({
        type: "blockquote",
        content: [{ type: "paragraph", content: parseInline(quoteLines.join(" ")) }],
      });
      continue;
    }

    // Bullet list (-, *, + with a space)
    if (line.match(/^[\-\*\+]\s+/)) {
      const items: AdfNode[] = [];
      while (i < lines.length && lines[i].match(/^[\-\*\+]\s+/)) {
        const itemText = lines[i].replace(/^[\-\*\+]\s+/, "").replace(/^\[[ xX]\]\s*/, "");
        items.push({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInline(itemText) }],
        });
        i++;
      }
      content.push({ type: "bulletList", content: items });
      continue;
    }

    // Ordered list
    if (line.match(/^\d+[.)]\s+/)) {
      const items: AdfNode[] = [];
      while (i < lines.length && lines[i].match(/^\d+[.)]\s+/)) {
        const itemText = lines[i].replace(/^\d+[.)]\s+/, "");
        items.push({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInline(itemText) }],
        });
        i++;
      }
      content.push({ type: "orderedList", content: items });
      continue;
    }

    // Table
    if (line.startsWith("|")) {
      const headerCells: string[] = [];
      const bodyRows: string[][] = [];
      let firstRow = true;
      let hasHeader = false;

      while (i < lines.length && lines[i].startsWith("|")) {
        const row = lines[i];
        i++;
        // Separator row: |---|---|
        if (row.match(/^\|[\s\-:|]+\|[\s\-:|]*$/)) {
          hasHeader = true;
          continue;
        }
        const cells = row
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim());

        if (firstRow) {
          headerCells.push(...cells);
          firstRow = false;
        } else {
          bodyRows.push(cells);
        }
      }

      const tableContent: AdfNode[] = [];

      if (headerCells.length > 0) {
        tableContent.push({
          type: "tableRow",
          content: headerCells.map((cell) => ({
            type: hasHeader ? "tableHeader" : "tableCell",
            attrs: {},
            content: [{ type: "paragraph", content: parseInline(cell) }],
          })),
        });
      }

      for (const row of bodyRows) {
        tableContent.push({
          type: "tableRow",
          content: row.map((cell) => ({
            type: "tableCell",
            attrs: {},
            content: [{ type: "paragraph", content: parseInline(cell) }],
          })),
        });
      }

      if (tableContent.length > 0) {
        content.push({
          type: "table",
          attrs: { isNumberColumnEnabled: false, layout: "default" },
          content: tableContent,
        });
      }
      continue;
    }

    // Paragraph — collect consecutive non-block lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].match(/^[\-\*\+]\s/) &&
      !lines[i].match(/^\d+[.)]\s/) &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("|") &&
      !lines[i].startsWith("> ") &&
      !lines[i].match(/^[-*_]{3,}\s*$/)
    ) {
      paraLines.push(lines[i]);
      i++;
    }

    if (paraLines.length > 0) {
      content.push({
        type: "paragraph",
        content: parseInline(paraLines.join(" ")),
      });
    }
  }

  // ADF doc must have at least one node
  if (content.length === 0) {
    content.push({ type: "paragraph", content: [{ type: "text", text: "" }] });
  }

  return { version: 1, type: "doc", content };
}
