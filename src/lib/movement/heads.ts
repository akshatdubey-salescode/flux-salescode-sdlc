/**
 * Current head SHA of PRs, for the "record is stale" warning.
 *
 * One GitHub GraphQL call per org per <= 30 PRs (aliased `repository(...).pullRequest(...)`
 * nodes), using the org tokens Flux already holds (loadActiveOrgs). GitHubClient is GET-only by
 * design and GraphQL needs POST, so this has its own tiny transport, locked to api.github.com
 * and used for a fixed READ-ONLY query text (no caller input is ever concatenated into it:
 * owner, repo and number travel as variables). Every failure degrades to "unknown" for the
 * PRs it touched; nothing throws out of the flow, and tokens are never logged or returned.
 */
import { mapLimit } from "./jira-source";
import { prKey } from "./record";

export const HEAD_UNKNOWN = "unknown";
export const HEADS_PER_CALL = 30;
const MAX_PRS = 300;
const MAX_CONCURRENT_CALLS = 3;
const GRAPHQL_URL = "https://api.github.com/graphql";
const TIMEOUT_MS = 15_000;

export interface PrToCheck {
  /** `salescode-ai/channelkart` (the owner picks the org token). */
  repoFullName: string;
  number: number;
}

export interface GraphQlResponse {
  data?: Record<string, { pullRequest?: { headRefOid?: string | null } | null } | null> | null;
  errors?: unknown;
}

/** (token, query, variables) -> parsed response. Throws on transport/HTTP failure. */
export type GraphQlTransport = (token: string, query: string, variables: Record<string, unknown>) => Promise<GraphQlResponse>;

export interface HeadsOptions {
  transport?: GraphQlTransport;
  /** Org login -> token. Default: loadActiveOrgs(). Tests pass a fixed map. */
  tokens?: Map<string, string>;
  chunkSize?: number;
}

/** The real transport: POST, host locked, 15 s timeout, no redirects, error text without headers. */
const fetchTransport: GraphQlTransport = async (token, query, variables) => {
  // Read-only by construction: the only query text ever sent comes from headsQuery().
  if (!query.startsWith("query ") || /mutation/i.test(query)) throw new Error("only read-only queries are allowed");
  const url = new URL(GRAPHQL_URL);
  if (url.host !== "api.github.com") throw new Error("GraphQL host not allowed");
  const res = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL HTTP ${res.status}`);
  return (await res.json()) as GraphQlResponse;
};

/** Query text for n aliased PRs. Pure; the only dynamic part is the alias count. */
export function headsQuery(n: number): string {
  const decl: string[] = [];
  const body: string[] = [];
  for (let i = 0; i < n; i++) {
    decl.push(`$o${i}: String!, $n${i}: String!, $p${i}: Int!`);
    body.push(`r${i}: repository(owner: $o${i}, name: $n${i}) { pullRequest(number: $p${i}) { headRefOid } }`);
  }
  return `query Heads(${decl.join(", ")}) { ${body.join(" ")} }`;
}

async function defaultTokens(): Promise<Map<string, string>> {
  // Imported lazily: it pulls in the database client, which pure callers and tests do not need.
  const { loadActiveOrgs } = await import("@/lib/github/orgs");
  const m = new Map<string, string>();
  for (const o of await loadActiveOrgs()) m.set(o.login.toLowerCase(), o.token);
  return m;
}

/**
 * Map `repoName#number` (the parser's PR identity) -> head SHA, or "unknown" when it could not
 * be read (no token for the org, repo/PR not visible, HTTP or GraphQL error, over the PR cap).
 */
export async function fetchPrHeads(prs: readonly PrToCheck[], opts: HeadsOptions = {}): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  // Identity is owner/name#number; the result is keyed by the parser's `name#number`. Two owners
  // with the same repo name would collide there, so such a PR is reported "unknown" instead of
  // guessing which one is meant.
  const unique = new Map<string, PrToCheck>();
  const outKeyOwners = new Map<string, Set<string>>();
  for (const p of prs) {
    const full = `${p.repoFullName.trim().toLowerCase()}#${p.number}`;
    if (unique.has(full)) continue;
    unique.set(full, p);
    const ok = prKey(p.repoFullName, p.number);
    const set = outKeyOwners.get(ok);
    if (set) set.add(full);
    else outKeyOwners.set(ok, new Set([full]));
  }
  for (const ok of outKeyOwners.keys()) out.set(ok, HEAD_UNKNOWN);
  const all: Array<[string, PrToCheck]> = [];
  for (const p of unique.values()) {
    const ok = prKey(p.repoFullName, p.number);
    // Ambiguous across owners, or a number GitHub's Int cannot take: stays unknown, never throws.
    if ((outKeyOwners.get(ok)?.size ?? 0) > 1 || !Number.isInteger(p.number) || p.number < 1 || p.number > 2_147_483_647) continue;
    all.push([ok, p]);
  }
  if (all.length === 0) return out;

  let tokens: Map<string, string>;
  try {
    tokens = opts.tokens ?? (await defaultTokens());
  } catch {
    return out; // no tokens: everything stays unknown
  }
  const transport = opts.transport ?? fetchTransport;
  const size = opts.chunkSize ?? HEADS_PER_CALL;

  // Group by owner so each call uses the token of the org that owns the repos.
  const byOwner = new Map<string, Array<[string, PrToCheck, string]>>();
  for (const [k, p] of all.slice(0, MAX_PRS)) {
    const parts = p.repoFullName.trim().split("/").filter(Boolean);
    const owner = parts.length > 1 ? parts[parts.length - 2] : "";
    const name = parts.length ? parts[parts.length - 1] : "";
    if (!owner || !name || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) continue;
    const list = byOwner.get(owner.toLowerCase());
    const row: [string, PrToCheck, string] = [k, p, `${owner}/${name}`];
    if (list) list.push(row);
    else byOwner.set(owner.toLowerCase(), [row]);
  }

  const calls: Array<{ token: string; rows: Array<[string, PrToCheck, string]> }> = [];
  for (const [owner, rows] of byOwner) {
    const token = tokens.get(owner);
    if (!token) continue;
    for (let i = 0; i < rows.length; i += size) calls.push({ token, rows: rows.slice(i, i + size) });
  }

  await mapLimit(calls, MAX_CONCURRENT_CALLS, async ({ token, rows }) => {
    try {
      const variables: Record<string, unknown> = {};
      rows.forEach(([, p, full], i) => {
        const [o, n] = full.split("/");
        variables[`o${i}`] = o;
        variables[`n${i}`] = n;
        variables[`p${i}`] = p.number;
      });
      const res = await transport(token, headsQuery(rows.length), variables);
      rows.forEach(([k], i) => {
        const sha = res?.data?.[`r${i}`]?.pullRequest?.headRefOid;
        if (typeof sha === "string" && /^[0-9a-f]{7,64}$/i.test(sha)) out.set(k, sha.toLowerCase());
      });
    } catch {
      // Left as unknown. The message is not logged: it could echo request details.
    }
  });
  return out;
}

/** True when the two SHAs name the same commit (either may be abbreviated; both >= 7 chars). */
export function sameHead(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  if (x.length < 7 || y.length < 7) return false;
  return x.startsWith(y) || y.startsWith(x);
}
