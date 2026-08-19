/** Extract plain text from Atlassian Document Format JSON. */
export function adfToText(body: string | null): string {
  if (!body) return "";
  try {
    const doc = JSON.parse(body) as Record<string, unknown>;
    const texts: string[] = [];
    function walk(node: unknown) {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.type === "text" && typeof n.text === "string") {
        texts.push(n.text);
      }
      if (Array.isArray(n.content)) {
        for (const child of n.content) walk(child);
      }
    }
    walk(doc);
    return texts.join(" ").trim();
  } catch {
    return body;
  }
}
