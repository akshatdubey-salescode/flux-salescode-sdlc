"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { TcSummary } from "@/lib/test-cases/summary";
import type { TcSummariesResponse } from "@/app/api/test-cases/summaries/route";

/**
 * Module-level batcher shared by every <TcBadge>, so the Sprint and Delivery
 * tabs share one cache and one request per render pass.
 *
 * Entry states: `undefined` = unresolved; `null` = feature off or fetch failed
 * (render nothing); `NO_TCS` = resolved, the issue has no test cases;
 * a TcSummary = has test cases.
 *
 * Unlike read-only RCA data, TC status changes from other pages (commit,
 * review, sign-off), so entries expire (STALE_MS) and are refetched the next
 * time a chip mounts, and TC pages call invalidateTcSummaries() right after a
 * change so the rows are correct on return.
 */
export const NO_TCS = { hasTcs: false } as const;
export type TcCacheEntry = TcSummary | typeof NO_TCS | null;

const STALE_MS = 30_000;
const cache = new Map<string, { value: TcCacheEntry; at: number }>();
const subscribers = new Map<string, Set<() => void>>();
const pending = new Set<string>();
const inFlight = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function notify(issueId: string) {
  for (const cb of subscribers.get(issueId) ?? []) cb();
}

function scheduleFlush() {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(flush, 0);
}

async function flush() {
  flushTimer = null;
  const batch = [...pending];
  pending.clear();
  if (batch.length === 0) return;
  for (const id of batch) inFlight.add(id);

  try {
    const res = await fetch("/api/test-cases/summaries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issueIds: batch }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { enabled, summaries } = (await res.json()) as TcSummariesResponse;
    const now = Date.now();
    for (const id of batch) {
      cache.set(id, { value: !enabled ? null : (summaries[id] ?? NO_TCS), at: now });
      notify(id);
    }
  } catch (e) {
    // A status chip is a nice-to-have: fail quiet rather than retry-loop.
    console.warn("[tc-summary-cache] batch fetch failed:", e);
    const now = Date.now();
    for (const id of batch) {
      // Keep a previously known value on a failed refresh.
      if (!cache.has(id)) cache.set(id, { value: null, at: now });
      else cache.set(id, { value: cache.get(id)!.value, at: now });
      notify(id);
    }
  } finally {
    for (const id of batch) inFlight.delete(id);
  }
}

function registerInterest(issueId: string) {
  const hit = cache.get(issueId);
  if (hit && Date.now() - hit.at < STALE_MS) return;
  if (pending.has(issueId) || inFlight.has(issueId)) return;
  pending.add(issueId);
  scheduleFlush();
}

function subscribe(issueId: string, callback: () => void): () => void {
  registerInterest(issueId);
  let set = subscribers.get(issueId);
  if (!set) {
    set = new Set();
    subscribers.set(issueId, set);
  }
  set.add(callback);
  return () => {
    set!.delete(callback);
    if (set!.size === 0) subscribers.delete(issueId);
  };
}

/** Drop everything cached; mounted chips refetch immediately. Call after any TC change. */
export function invalidateTcSummaries() {
  cache.clear();
  for (const id of subscribers.keys()) {
    pending.add(id);
  }
  if (pending.size > 0) scheduleFlush();
}

export function useTcSummary(issueId: string): TcCacheEntry | undefined {
  const subscribeForIssue = useCallback((callback: () => void) => subscribe(issueId, callback), [issueId]);
  return useSyncExternalStore(subscribeForIssue, () => cache.get(issueId)?.value, () => undefined);
}
