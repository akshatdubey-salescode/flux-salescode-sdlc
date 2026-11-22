/**
 * In-memory Jira for tests and load simulations: understands exactly the JQL shapes the movement
 * code sends (`key in (...)`, `parent in (...)`, `issue in (...) AND comment ~ "DEPLOYMENT-RECORD"`),
 * pages like the real API, and counts every request. Never talks to a network.
 */
import { looksLikeRecord, parseDeploymentRecord, type ParsedRecord } from "./record";
import { loadFixture } from "./record/testkit";
import type { JiraSource } from "./jira-source";

/** A real Jira comment (ADF exactly as Jira returned it) from record/__fixtures__. */
export function fixtureComment(name: string): FakeComment {
  const f = loadFixture(name);
  return { id: String(f.id), body: f.body, created: f.created ?? null, updated: f.updated ?? null };
}

/** The same fixture, parsed. */
export function parsedFixture(name: string): ParsedRecord {
  const r = parseDeploymentRecord(loadFixture(name));
  if (!r) throw new Error(`fixture ${name} is not a record`);
  return r;
}

/** A plain-text ADF comment of about `bytes` bytes that is not a deployment record. */
export function noiseComment(id: string, createdMs: number, bytes = 200): FakeComment {
  const text = "lorem ipsum dolor sit amet ".repeat(Math.ceil(bytes / 27)).slice(0, bytes);
  const at = new Date(createdMs).toISOString();
  return {
    id,
    created: at,
    updated: at,
    body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  };
}

export interface FakeComment {
  id: string;
  body: unknown;
  created?: string | null;
  updated?: string | null;
}

export interface FakeIssue {
  key: string;
  summary?: string;
  /** Issue type name; `subtask: true` marks sub-task types. Default Task. */
  type?: string;
  subtask?: boolean;
  status?: string;
  parent?: string;
  links?: Array<{ key: string; type?: string }>;
  comments?: FakeComment[];
}

export class FakeJira implements JiraSource {
  readonly issues = new Map<string, FakeIssue>();
  searchCalls = 0;
  commentCalls = 0;
  /** Every JQL string received, for assertions on the call shapes. */
  readonly jqls: string[] = [];
  /** When set, the next matching calls throw (to test degradation). */
  failSearchWhen?: (jql: string) => boolean;
  failCommentsFor = new Set<string>();

  constructor(issues: FakeIssue[] = []) {
    for (const i of issues) this.issues.set(i.key, i);
  }

  get calls(): number {
    return this.searchCalls + this.commentCalls;
  }

  add(i: FakeIssue): this {
    this.issues.set(i.key, i);
    return this;
  }

  private brief(i: FakeIssue) {
    return {
      summary: i.summary ?? `Summary of ${i.key}`,
      status: { name: i.status ?? "In Progress" },
      issuetype: { name: i.type ?? (i.subtask ? "Sub-task" : "Task"), subtask: i.subtask === true },
    };
  }

  private fieldsOf(i: FakeIssue, wanted: string[]): Record<string, unknown> {
    const all: Record<string, unknown> = {
      ...this.brief(i),
      parent: i.parent ? { key: i.parent, fields: this.brief(this.issues.get(i.parent) ?? { key: i.parent }) } : undefined,
      subtasks: [...this.issues.values()]
        .filter((c) => c.parent === i.key && c.subtask)
        .map((c) => ({ key: c.key, fields: this.brief(c) })),
      issuelinks: (i.links ?? []).map((l) => {
        const other = this.issues.get(l.key) ?? { key: l.key };
        return { type: { name: l.type ?? "Relates" }, outwardIssue: { key: l.key, fields: this.brief(other) } };
      }),
    };
    const out: Record<string, unknown> = {};
    for (const f of wanted) if (f in all && all[f] !== undefined) out[f] = all[f];
    return out;
  }

  async searchByJql(jql: string, opts: { fields: string[]; nextPageToken?: string; maxResults?: number }) {
    this.searchCalls++;
    this.jqls.push(jql);
    if (this.failSearchWhen?.(jql)) throw new Error("Jira search failed (503): simulated");
    const inList = /\b(key|parent|issue) in \(([^)]*)\)/i.exec(jql);
    if (!inList) throw new Error(`FakeJira cannot parse: ${jql}`);
    const field = inList[1].toLowerCase();
    const keys = inList[2].split(",").map((s) => s.trim().replace(/"/g, ""));
    let hits = [...this.issues.values()].filter((i) => (field === "parent" ? !!i.parent && keys.includes(i.parent) : keys.includes(i.key)));
    if (/comment ~ "DEPLOYMENT-RECORD"/i.test(jql)) {
      hits = hits.filter((i) => (i.comments ?? []).some((c) => looksLikeRecord(c.body)));
    }
    hits.sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }));
    const start = opts.nextPageToken ? Number(opts.nextPageToken) : 0;
    const size = opts.maxResults ?? 50;
    const page = hits.slice(start, start + size);
    return {
      issues: page.map((i) => ({ key: i.key, fields: this.fieldsOf(i, opts.fields) })),
      nextPageToken: start + size < hits.length ? String(start + size) : undefined,
    };
  }

  async fetchIssueComments(key: string, opts: { startAt?: number; maxResults?: number } = {}) {
    this.commentCalls++;
    if (this.failCommentsFor.has(key)) throw new Error(`Jira comments of "${key}" failed (500): simulated`);
    const issue = this.issues.get(key);
    if (!issue) throw new Error(`Jira comments of "${key}" failed (404): not found`);
    const all = [...(issue.comments ?? [])].sort((a, b) => Date.parse(b.created ?? "") - Date.parse(a.created ?? "") || Number(b.id) - Number(a.id));
    const startAt = opts.startAt ?? 0;
    const max = opts.maxResults ?? 50;
    return { startAt, total: all.length, comments: all.slice(startAt, startAt + max) };
  }
}
