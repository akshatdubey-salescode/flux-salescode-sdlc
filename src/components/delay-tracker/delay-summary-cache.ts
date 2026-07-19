"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { DelaySummary } from "@/lib/delay-tracker/entries";
import type { DelaySummariesResponse } from "@/app/api/delay-tracker/summaries/route";
import { categoryLabel, pickTopCategory } from "@/lib/delay-tracker/categories";

/**
 * Module-level batcher shared by every <DelayLogButton> on the page. Each
 * button registers interest in its own issueId; every issueId registered
 * within one macrotask gets bundled into a single POST, so a table with 50
 * rows fires one request instead of 50 — the icon/tooltip work stays purely
 * additive to the existing "nothing fetches until you click" design.
 *
 * `undefined` = not yet resolved, `null` = resolved, no delays.
 */
const cache = new Map<string, DelaySummary | null>();
const subscribers = new Map<string, Set<() => void>>();
const pending = new Set<string>();
// issueIds already folded into a batch that's been sent but hasn't resolved
// yet — kept separate from `pending` (which only holds the *next* batch) so
// a re-subscribe for an id already in flight doesn't escape the dedup check
// below and fire a second, redundant request for the same id.
const inFlight = new Set<string>();
// Bumped on every write to `cache` for an issueId, whether from a batch
// response or a local patch. A batch response only applies if the version it
// captured at send-time still matches when the response arrives — otherwise
// something fresher (usually a local patch right after a create/edit/delete)
// already won, and the stale response is discarded instead of overwriting it.
// Never explicitly initialized to 0 — every read normalizes a missing entry
// to 0 (via `?? 0`) rather than comparing against a raw `undefined`, which
// would make a brand-new issueId's very first flush always look "stale"
// (undefined !== 0) and get silently discarded before it's ever applied.
const versions = new Map<string, number>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function versionOf(issueId: string): number {
  return versions.get(issueId) ?? 0;
}

function bump(issueId: string) {
  versions.set(issueId, versionOf(issueId) + 1);
}

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

  const sentVersions = new Map(batch.map((id) => [id, versionOf(id)]));
  for (const id of batch) inFlight.add(id);

  try {
    const res = await fetch("/api/delay-tracker/summaries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issueIds: batch }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { summaries } = (await res.json()) as DelaySummariesResponse;
    for (const issueId of batch) {
      if (versionOf(issueId) !== sentVersions.get(issueId)) continue;
      cache.set(issueId, summaries[issueId] ?? null);
      bump(issueId);
      notify(issueId);
    }
  } catch (e) {
    // Icon coloring is a nice-to-have, not critical path — fail quiet (show
    // "no delay") rather than retry-looping a broken endpoint.
    console.warn("[delay-summary-cache] batch fetch failed:", e);
    for (const issueId of batch) {
      if (versionOf(issueId) !== sentVersions.get(issueId)) continue;
      cache.set(issueId, null);
      bump(issueId);
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
 * Recomputes an issue's summary from its full active + deleted history
 * (already in memory inside DelayTrackerPanel right after a create/update/
 * delete) and pushes it into the shared cache — every button showing that
 * issue recolors immediately, no refetch needed. Prefers active entries;
 * falls back to deleted ones (with `allDeleted: true`) so the icon stays
 * amber even once the last active entry is removed, matching
 * fetchDelaySummaries' server-side semantics.
 */
export function patchDelaySummary(
  issueId: string,
  activeHistory: { category: string; delayDate: string }[],
  deletedHistory: { category: string; delayDate: string }[]
) {
  const source = activeHistory.length > 0 ? activeHistory : deletedHistory;
  if (source.length === 0) {
    cache.set(issueId, null);
    bump(issueId);
    notify(issueId);
    return;
  }
  const categories = new Map<string, number>();
  let latest = source[0].delayDate;
  for (const h of source) {
    categories.set(h.category, (categories.get(h.category) ?? 0) + 1);
    if (h.delayDate > latest) latest = h.delayDate;
  }
  const [topCategory] = pickTopCategory(categories);
  cache.set(issueId, {
    count: source.length,
    topCategory,
    topCategoryLabel: categoryLabel(topCategory),
    latestDelayDate: latest,
    allDeleted: activeHistory.length === 0,
  });
  bump(issueId);
  notify(issueId);
}

/** `undefined` while unresolved, `null` once confirmed no delays, else the summary. */
export function useDelaySummary(issueId: string): DelaySummary | null | undefined {
  const subscribeForIssue = useCallback(
    (callback: () => void) => subscribe(issueId, callback),
    [issueId]
  );
  return useSyncExternalStore(subscribeForIssue, () => cache.get(issueId), () => undefined);
}
