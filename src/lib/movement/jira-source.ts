/**
 * The two Jira reads the movement feature needs, as an interface so tests inject a fake and the
 * real `JiraClient` satisfies it structurally (see jira-source.test.ts).
 */
export interface JiraSource {
  searchByJql(
    jql: string,
    opts: { fields: string[]; nextPageToken?: string; maxResults?: number }
  ): Promise<{ issues: Array<{ key: string; fields: Record<string, unknown> }>; nextPageToken?: string }>;

  /** Newest first. */
  fetchIssueComments(
    key: string,
    opts?: { startAt?: number; maxResults?: number }
  ): Promise<{
    startAt: number;
    total: number;
    comments: Array<{ id: string; body: unknown; created?: string | null; updated?: string | null }>;
  }>;
}

/** Jira keys as the movement feature accepts them (also safe to put in JQL and in a regex). */
export const JIRA_KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/;

export function isJiraKey(s: unknown): s is string {
  return typeof s === "string" && JIRA_KEY_RE.test(s);
}

/** Split into chunks of `size` (>= 1). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Run `fn` over `items` with at most `limit` in flight. Results keep the input order. A rejected
 * `fn` rejects the whole call, so callers that want degradation catch inside `fn`.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return out;
}
