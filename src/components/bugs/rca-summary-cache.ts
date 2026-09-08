"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { RcaSummary } from "@/lib/jira/rca";
import type { RcaSummariesResponse } from "@/app/api/bugs/rca-summaries/route";

/**
 * Module-level batcher shared by every <RcaBadge> on the page — same shape as
 * delay-summary-cache.ts, minus a patch/write path: RCA is read-only from
 * Flux's side (set in Jira, never edited here), so there's no local mutation
 * to reconcile against a batch response the way delay logs have.
 *
 * `undefined` = not yet resolved. `null` = resolved, not applicable (not a
 * bug-type issue) or the fetch failed. An RcaSummary object = resolved, is a
 * bug (given true or false).
 */
const cache = new Map<string, RcaSummary | null>();
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
    const res = await fetch("/api/bugs/rca-summaries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issueIds: batch }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { summaries } = (await res.json()) as RcaSummariesResponse;
    for (const issueId of batch) {
      cache.set(issueId, summaries[issueId] ?? null);
      notify(issueId);
    }
  } catch (e) {
    // Icon visibility is a nice-to-have, not critical path — fail quiet
    // (render nothing) rather than retry-looping a broken endpoint.
    console.warn("[rca-summary-cache] batch fetch failed:", e);
    for (const issueId of batch) {
      cache.set(issueId, null);
      notify(issueId);
    }
  } finally {
    for (const id of batch) inFlight.delete(id);
  }
}

function registerInterest(issueId: string) {
  if (cache.has(issueId) || pending.has(issueId) || inFlight.has(issueId)) return;
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

/**
 * `undefined` while unresolved. `null` once confirmed not applicable (not a
 * bug) or the fetch failed. Else the RCA summary for a bug-type issue.
 */
export function useRcaSummary(issueId: string): RcaSummary | null | undefined {
  const subscribeForIssue = useCallback(
    (callback: () => void) => subscribe(issueId, callback),
    [issueId]
  );
  return useSyncExternalStore(subscribeForIssue, () => cache.get(issueId), () => undefined);
}
