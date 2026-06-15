// Convert an Atlassian Document Format (ADF) value — as stored in
// jira_issues.description (a JSON-stringified ADF document) — into plain text.
// Block-level nodes emit a line break so multi-paragraph descriptions stay
// readable (e.g. in a spreadsheet cell with wrap). Falls back to the raw input
// if it isn't valid ADF JSON.

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "listItem",
  "codeBlock",
  "tableRow",
  "rule",
]);

export function adfToText(body: string | null | undefined): string {
  if (!body) return "";
  try {
    const doc = JSON.parse(body);
    // Some issues store the description as a plain string (Jira REST v2 style)
    // rather than an ADF document object — return it as-is.
    if (typeof doc === "string") return doc.trim();
    if (!doc || typeof doc !== "object") return String(doc ?? "").trim();
    const out: string[] = [];

    function walk(node: unknown) {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.type === "text" && typeof n.text === "string") out.push(n.text);
      if (n.type === "hardBreak") out.push("\n");
      if (Array.isArray(n.content)) {
        for (const child of n.content) walk(child);
      }
      if (typeof n.type === "string" && BLOCK_TYPES.has(n.type)) out.push("\n");
    }

    walk(doc);
    return out.join("").replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return body;
  }
}
