/**
 * Load the DEPLOYMENT-RECORD comments of the Jiras in a movement, cheaply.
 *
 * The model: each Jira carries ONE review comment (the newest DEPLOYMENT-RECORD on the ticket) that lists
 * every PR (a "union" record, `facts.covers`). Older tickets have one record per PR (legacy); those still
 * work. Flux no longer looks PRs up anywhere: what is covered is what the comments say.
 *
 * Which issues get their comments read: the roots always. Every other tree node is found with ONE JQL per
 * 50 keys (`comment ~ "DEPLOYMENT-RECORD"`) and only the hits are read. Comments come newest first in pages
 * of 50; reading stops as soon as at least one record is held and every sibling PR the held records name
 * has a record too (a union record covers all of its own PRs), or after 200 comments. Each comment is
 * classified with the cheap first-text check BEFORE anything is parsed and a non-record is dropped on the
 * spot, so raw pages are never accumulated; a record is parsed once and cached by (commentId, updated), and
 * only the newest record per PR (and, bounded, per union) is held while paging.
 *
 * Discovery relies on Jira's comment search index, which is eventually consistent: a record posted
 * a few seconds ago may not be searchable yet. So an explicit Refresh (`bypassResultCache`) does
 * not trust it: when the run has <= 150 nodes every non-linked node is read directly instead of
 * going through the `comment ~` discovery (above 150 nodes discovery is used, as the call budget
 * demands). A normal open may therefore miss a record on a sub-Jira for a short while.
 */
import { ByteLru, RESULT_CACHE_BYTES, RESULT_CACHE_TTL_MS, PARSED_RECORD_CACHE_BYTES, recordCacheKey } from "./cache";
import { chunk, mapLimit, type JiraSource } from "./jira-source";
import { coversOf, isUnion, recordIdentity } from "./covers";
import { approxBytes, looksLikeRecord, parseDeploymentRecord, pickNewestRecords, prKey, type ParsedRecord, type PrRef } from "./record";
import { resolveRepoAlias } from "./repo-names";
import type { TreeNode } from "./tree";

export interface IssueRecords {
  issueKey: string;
  /**
   * Newest record per `repo#PR`, newest first, followed by the surviving UNION records (one review
   * comment that covers several PRs; see covers.ts).
   */
  records: ParsedRecord[];
  commentsSeen: number;
  /** Every comment of the issue was read (false when reading stopped early or at the cap). */
  exhausted: boolean;
  /** The 200-comment cap stopped the read before all expected PRs had a record. */
  capped: boolean;
  /** Jira failed while reading: `records` is what was read before the failure. */
  error?: string;
}

export interface LoadStats {
  jiraCalls: number;
  commentsSeen: number;
  recordsParsed: number;
  /** Parsed-record cache hits (a record seen again with the same updated time). */
  cacheHits: number;
  /** Issues served from the 60 s per-Jira result cache (no Jira call at all). */
  issueCacheHits: number;
  issuesRead: number;
  discoveryFailed: number;
}

export interface LoadResult {
  byIssue: Map<string, IssueRecords>;
  stats: LoadStats;
}

export interface LoadOptions {
  maxComments?: number;
  pageSize?: number;
  concurrency?: number;
  batchSize?: number;
  /** Parsed records by `${commentId}:${updated}`; defaults to the shared 8 MB instance. */
  recordCache?: ByteLru<string, ParsedRecord>;
  /** Per-Jira results for 60 s; defaults to the shared instance. */
  resultCache?: ByteLru<string, IssueRecords>;
  /** Explicit Refresh: skip the 60 s result cache and the discovery JQL (see the header). */
  bypassResultCache?: boolean;
}

/** Above this many nodes a Refresh falls back to the discovery JQL. */
export const DIRECT_READ_MAX_NODES = 150;

/** Reads in flight per result cache, so two simultaneous loads of one issue make one Jira read. */
const inflightByCache = new WeakMap<object, Map<string, Promise<IssueRecords>>>();

let sharedRecordCache: ByteLru<string, ParsedRecord> | undefined;
let sharedResultCache: ByteLru<string, IssueRecords> | undefined;

export function sharedRecordCacheInstance(): ByteLru<string, ParsedRecord> {
  return (sharedRecordCache ??= new ByteLru({ maxBytes: PARSED_RECORD_CACHE_BYTES, weigh: approxBytes }));
}

export function sharedResultCacheInstance(): ByteLru<string, IssueRecords> {
  return (sharedResultCache ??= new ByteLru({
    maxBytes: RESULT_CACHE_BYTES,
    ttlMs: RESULT_CACHE_TTL_MS,
    weigh: (v) => 256 + v.records.reduce((n, r) => n + approxBytes(r), 0),
  }));
}

/**
 * Siblings (`repo#pr` pairs the held records name) that no held record covers yet: a PR counts as covered when ANY
 * record covers it (a per-PR record its own PR, a union record every PR it lists), repo spellings reconciled through
 * the alias table against the repos the records themselves name.
 */
function unsatisfied(expected: readonly PrRef[], records: readonly ParsedRecord[]): PrRef[] {
  const have = new Set<string>();
  const repos = new Set<string>();
  for (const r of records) {
    for (const c of coversOf(r)) {
      have.add(prKey(c.repo, c.pr));
      repos.add(c.repo);
    }
  }
  return expected.filter((e) => !have.has(prKey(resolveRepoAlias(e.repo, repos), e.pr)));
}

/** Union records kept per issue while paging (the newest 20; more is not a real case and must not grow memory). */
const MAX_UNION_RECORDS = 20;

/** Siblings a record names that still need their own record (closed ones do not). */
function siblingRefs(r: ParsedRecord): PrRef[] {
  return (r.facts.siblings ?? []).filter((s) => s.state !== "closed");
}

export async function loadRecords(
  jira: JiraSource,
  nodes: readonly TreeNode[],
  opts: LoadOptions = {}
): Promise<LoadResult> {
  const maxComments = opts.maxComments ?? 200;
  const pageSize = opts.pageSize ?? 50;
  const concurrency = opts.concurrency ?? 5;
  const batch = opts.batchSize ?? 50;
  const recordCache = opts.recordCache ?? sharedRecordCacheInstance();
  const resultCache = opts.resultCache ?? sharedResultCacheInstance();
  const stats: LoadStats = { jiraCalls: 0, commentsSeen: 0, recordsParsed: 0, cacheHits: 0, issueCacheHits: 0, issuesRead: 0, discoveryFailed: 0 };
  const byIssue = new Map<string, IssueRecords>();

  const unique = new Map<string, TreeNode>();
  for (const n of nodes) if (!unique.has(n.key)) unique.set(n.key, n);

  const direct: string[] = [];
  const maybe: string[] = [];
  const readAll = opts.bypassResultCache === true && unique.size <= DIRECT_READ_MAX_NODES;
  for (const n of unique.values()) {
    if (n.kind === "root" || (readAll && n.kind !== "linked")) direct.push(n.key);
    else maybe.push(n.key);
  }

  // ---- discovery for the nodes that own no PR: one JQL per 50 keys
  const discovered: string[] = [];
  const failedDiscovery = new Map<string, IssueRecords>();
  await mapLimit(chunk(maybe, batch), concurrency, async (part) => {
    try {
      stats.jiraCalls++;
      const res = await jira.searchByJql(`issue in (${part.join(",")}) AND comment ~ "DEPLOYMENT-RECORD"`, {
        fields: ["summary"],
        maxResults: batch,
      });
      for (const i of res.issues) if (part.includes(i.key)) discovered.push(i.key);
    } catch (e) {
      // Fail visibly: every key of the batch is reported as unreadable (comments_unreadable).
      stats.discoveryFailed += part.length;
      const error = `record discovery failed: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`;
      for (const k of part) failedDiscovery.set(k, { issueKey: k, records: [], commentsSeen: 0, exhausted: false, capped: false, error });
    }
  });

  // ---- read the comments of one issue
  const readIssue = async (key: string): Promise<IssueRecords> => {
    const cached = opts.bypassResultCache ? undefined : resultCache.get(key);
    if (cached) {
      if (cached.exhausted || (cached.records.length > 0 && unsatisfied(cached.records.flatMap(siblingRefs), cached.records).length === 0)) {
        stats.issueCacheHits++;
        return cached;
      }
    }

    stats.issuesRead++;
    // Newest record per PR / per union only (records without repo/PR are kept up to a small cap).
    const newest = new Map<string, ParsedRecord>();
    const loose: ParsedRecord[] = [];
    let unions = 0;
    const held = (): ParsedRecord[] => [...newest.values(), ...loose];
    let seen = 0;
    let startAt = 0;
    let exhausted = false;
    let stopped = false;
    let error: string | undefined;
    try {
      for (;;) {
        stats.jiraCalls++;
        const page = await jira.fetchIssueComments(key, { startAt, maxResults: pageSize });
        const comments = page.comments.slice(0, Math.max(0, maxComments - seen));
        for (const c of comments) {
          seen++;
          stats.commentsSeen++;
          // Cheap first-text check: a non-record is dropped here, its body is never walked again.
          if (!looksLikeRecord(c.body)) continue;
          const ck = recordCacheKey(c.id, c.updated);
          let rec = recordCache.get(ck);
          if (rec) stats.cacheHits++;
          else {
            const parsed = parseDeploymentRecord({ id: c.id, body: c.body, created: c.created, updated: c.updated });
            if (!parsed) continue;
            stats.recordsParsed++;
            recordCache.set(ck, parsed);
            rec = parsed;
          }
          const id = recordIdentity(rec);
          if (id) {
            const old = newest.get(id);
            if (old) newest.set(id, pickNewestRecords([old, rec])[0]);
            else if (!isUnion(rec) || unions < MAX_UNION_RECORDS) {
              newest.set(id, rec);
              if (isUnion(rec)) unions++;
            }
          } else if (loose.length < 20) loose.push(rec);
        }
        startAt += page.comments.length;
        if (page.comments.length === 0 || startAt >= page.total) {
          exhausted = true;
          break;
        }
        const now = held();
        if (now.length > 0 && unsatisfied(now.flatMap(siblingRefs), now).length === 0) {
          stopped = true; // a record is held and every PR it names is covered: older comments cannot change that
          break;
        }
        if (seen >= maxComments) break;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const out: IssueRecords = {
      issueKey: key,
      records: pickNewestRecords(held()),
      commentsSeen: seen,
      exhausted,
      // The 200-comment cap ended the read before the end of the comments (an older record may exist).
      capped: !exhausted && !stopped && !error,
      ...(error ? { error } : {}),
    };
    if (!error) resultCache.set(key, out);
    return out;
  };

  let inflight = inflightByCache.get(resultCache);
  if (!inflight) inflightByCache.set(resultCache, (inflight = new Map()));
  const shared = inflight;
  const run = (key: string): Promise<IssueRecords> => {
    const running = shared.get(key);
    if (running) return running;
    const p = readIssue(key).finally(() => {
      shared.delete(key);
    });
    shared.set(key, p);
    return p;
  };

  for (const [k, v] of failedDiscovery) byIssue.set(k, v);
  const toRead = [...direct, ...discovered];
  const results = await mapLimit(toRead, concurrency, run);
  toRead.forEach((k, i) => byIssue.set(k, results[i]));
  return { byIssue, stats };
}
