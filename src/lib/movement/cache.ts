/**
 * Byte-bounded LRU (with optional TTL) for the movement feature.
 *
 * Two uses: parsed deployment records keyed by `${commentId}:${updated}` (the key changes when
 * the comment is edited, so an entry is immutable and never stale) and short-lived (60 s)
 * per-Jira result caching so a double click does not re-hit Jira. Memory can never grow past
 * `maxBytes`: every insert evicts the least recently used entries until the budget holds, and
 * a single value bigger than the whole budget is not stored at all.
 */

import { PARSER_VERSION } from "./values";

export interface ByteLruOptions<V> {
  /** Budget in bytes (as measured by `weigh`). */
  maxBytes: number;
  /** Approximate size of a value; must be pure. */
  weigh: (value: V) => number;
  /** Entries older than this are treated as absent. Omit for no expiry. */
  ttlMs?: number;
  /** Injected clock for tests. */
  now?: () => number;
}

interface Entry<V> {
  value: V;
  bytes: number;
  expiresAt: number;
}

/** Fixed bookkeeping cost per entry (Map slot + Entry object + key string). */
const ENTRY_OVERHEAD = 96;

export class ByteLru<K, V> {
  // A Map iterates in insertion order, so the first key is the least recently used one as long
  // as every read/write re-inserts its key at the end.
  private map = new Map<K, Entry<V>>();
  private total = 0;
  private readonly maxBytes: number;
  private readonly weigh: (value: V) => number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  hits = 0;
  misses = 0;
  evictions = 0;

  constructor(opts: ByteLruOptions<V>) {
    this.maxBytes = opts.maxBytes;
    this.weigh = opts.weigh;
    this.ttlMs = opts.ttlMs ?? Infinity;
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.map.size;
  }

  get bytes(): number {
    return this.total;
  }

  /** Read and mark as most recently used. Expired entries are dropped and read as a miss. */
  get(key: K): V | undefined {
    const e = this.map.get(key);
    if (!e) {
      this.misses++;
      return undefined;
    }
    if (e.expiresAt <= this.now()) {
      this.remove(key, e);
      this.misses++;
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, e);
    this.hits++;
    return e.value;
  }

  /** Presence check that neither refreshes recency nor counts as a hit. */
  has(key: K): boolean {
    const e = this.map.get(key);
    if (!e) return false;
    if (e.expiresAt <= this.now()) {
      this.remove(key, e);
      return false;
    }
    return true;
  }

  /**
   * Insert or replace. Returns false (and stores nothing, dropping any older value under the
   * key) when the value alone is larger than the budget.
   */
  set(key: K, value: V): boolean {
    const old = this.map.get(key);
    if (old) this.remove(key, old);
    const bytes = Math.max(0, this.weigh(value)) + ENTRY_OVERHEAD;
    if (bytes > this.maxBytes) return false;
    this.map.set(key, { value, bytes, expiresAt: this.now() + this.ttlMs });
    this.total += bytes;
    this.evict();
    return true;
  }

  delete(key: K): boolean {
    const e = this.map.get(key);
    if (!e) return false;
    this.remove(key, e);
    return true;
  }

  clear(): void {
    this.map.clear();
    this.total = 0;
  }

  private remove(key: K, e: Entry<V>): void {
    this.map.delete(key);
    this.total -= e.bytes;
  }

  private evict(): void {
    // Expired entries first (cheap: they sit anywhere), then the oldest.
    if (this.total <= this.maxBytes) return;
    const t = this.now();
    for (const [k, e] of this.map) {
      if (e.expiresAt <= t) this.remove(k, e);
    }
    while (this.total > this.maxBytes) {
      const first = this.map.entries().next();
      if (first.done) break;
      this.remove(first.value[0], first.value[1]);
      this.evictions++;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Shared instances
// ---------------------------------------------------------------------------------------------

/** Budget for parsed records (a parsed record is roughly 20-80 KB, so about 100-400 entries). */
export const PARSED_RECORD_CACHE_BYTES = 8 * 1024 * 1024;
/** Per-Jira result cache: 60 s so a double click or a quick Refresh does not re-hit Jira. */
export const RESULT_CACHE_TTL_MS = 60_000;
export const RESULT_CACHE_BYTES = 4 * 1024 * 1024;

/** `p<parser version>:${commentId}:${updated}` - an edit changes `updated` and a parser upgrade changes the version, so the key never goes stale. */
export function recordCacheKey(commentId: string | number, updated: string | null | undefined): string {
  return `p${PARSER_VERSION}:${commentId}:${updated ?? ""}`;
}
