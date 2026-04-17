import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requirements, jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { getValidCredentials } from "@/lib/atlassian/oauth";

// Re-uses the same sanitise + ADF conversion from the publish route.
// Kept inline here to avoid a shared module so the security contract
// (no admin token) is trivially auditable in one file.

const JIRA_API_BASE = "https://api.atlassian.com/ex/jira";

function sanitiseDescription(raw: string): string {
  let text = raw;
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  text = text.replace(/^#\s[^\n]*\n?/m, "");
  text = text.replace(/^##\s+Title\b[^\n]*\n[\s\S]*?(?=\n##\s|\n*$)/im, "");
  text = text.replace(/^##\s+Acceptance Criteria\b[^\n]*\n[\s\S]*?(?=\n##\s|\n*$)/im, "");
  text = text.replace(/\n---+\s*\n/g, "\n\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function inlineNodes(text: string): unknown[] {
  const nodes: unknown[] = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`|\*(.+?)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) nodes.push({ type: "text", text: m[1], marks: [{ type: "strong" }] });
    else if (m[2] !== undefined) nodes.push({ type: "text", text: m[2], marks: [{ type: "code" }] });
    else if (m[3] !== undefined) nodes.push({ type: "text", text: m[3], marks: [{ type: "em" }] });
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes.length > 0 ? nodes : [{ type: "text", text: "" }];
}

function markdownToAdf(markdown: string) {
  const lines = markdown.split("\n");
  const content: unknown[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }
    if (/^-{3,}$/.test(line.trim())) { i++; continue; }

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim() || null;
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { code.push(lines[i]); i++; }
      i++;
      content.push({ type: "codeBlock", attrs: { language: lang }, content: [{ type: "text", text: code.join("\n") }] });
      continue;
    }

    const hm = line.match(/^(#{1,6})\s+(.*)/);
    if (hm) {
      content.push({ type: "heading", attrs: { level: hm[1].length }, content: inlineNodes(hm[2]) });
      i++; continue;
    }

    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const raw = lines[i];
        if (/^\|[-:\s|]+\|$/.test(raw.trim())) { i++; continue; }
        rows.push(raw.split("|").slice(1, -1).map((c) => c.trim()));
        i++;
      }
      if (rows.length > 0) {
        content.push({
          type: "table",
          attrs: { isNumberColumnEnabled: false, layout: "default" },
          content: rows.map((cells, ri) => ({
            type: "tableRow",
            content: cells.map((cell) => ({
              type: ri === 0 ? "tableHeader" : "tableCell",
              attrs: {},
              content: [{ type: "paragraph", content: inlineNodes(cell) }],
            })),
          })),
        });
      }
      continue;
    }

    if (/^[-*]\s\[[ xX]\]\s/.test(line)) {
      const items: unknown[] = [];
      let idx = 0;
      while (i < lines.length && /^[-*]\s\[[ xX]\]\s/.test(lines[i])) {
        const done = /^[-*]\s\[[xX]\]\s/.test(lines[i]);
        const text = lines[i].replace(/^[-*]\s\[[ xX]\]\s/, "");
        items.push({ type: "taskItem", attrs: { localId: `task-${i}-${idx++}`, state: done ? "DONE" : "TODO" }, content: inlineNodes(text) });
        i++;
      }
      content.push({ type: "taskList", attrs: { localId: `tasklist-${i}` }, content: items });
      continue;
    }

    if (/^[-*]\s/.test(line)) {
      const items: unknown[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i]) && !/^[-*]\s\[[ xX]\]\s/.test(lines[i])) {
        const text = lines[i].replace(/^[-*]\s/, "");
        items.push({ type: "listItem", content: [{ type: "paragraph", content: inlineNodes(text) }] });
        i++;
      }
      content.push({ type: "bulletList", content: items });
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^[-*]\s/.test(lines[i]) &&
      !lines[i].startsWith("|") &&
      !/^-{3,}$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      content.push({ type: "paragraph", content: inlineNodes(paraLines.join(" ")) });
    }
  }

  return {
    version: 1,
    type: "doc",
    content: content.length > 0 ? content : [{ type: "paragraph", content: [] }],
  };
}

export async function POST(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await props.params;

  const [req] = await db
    .select()
    .from(requirements)
    .where(and(eq(requirements.id, id), eq(requirements.createdBy, user.id)))
    .limit(1);

  if (!req) return Response.json({ error: "Not found" }, { status: 404 });
  if (!req.jiraIssueKey) return Response.json({ error: "Not yet published to Jira" }, { status: 400 });

  const credentials = await getValidCredentials(user.id);
  if (!credentials?.accessToken || !credentials.cloudId) {
    return Response.json({ error: "Atlassian account not connected." }, { status: 422 });
  }

  let fullMarkdown = sanitiseDescription(req.description);
  if (req.acceptanceCriteria) {
    fullMarkdown += `\n\n## Acceptance Criteria\n\n${req.acceptanceCriteria}`;
  }

  const jiraRes = await fetch(
    `${JIRA_API_BASE}/${credentials.cloudId}/rest/api/3/issue/${req.jiraIssueKey}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        fields: { description: markdownToAdf(fullMarkdown) },
      }),
    }
  );

  if (!jiraRes.ok) {
    const body = await jiraRes.json().catch(() => ({}));
    const message =
      body?.errors
        ? Object.values(body.errors).join(", ")
        : body?.errorMessages?.[0] ?? `Jira API error (${jiraRes.status})`;
    return Response.json({ error: message }, { status: jiraRes.status });
  }

  console.info(`[resync-to-jira] Description resynced for ${req.jiraIssueKey} by user ${user.id}`);
  return Response.json({ success: true });
}
