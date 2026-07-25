"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { DeliverySummary } from "@/lib/deliveries/entries";
import type { DeliverySummariesResponse } from "@/app/api/deliveries/summaries/route";

/**
 * Module-level batcher shared by every <DeliveryBadge> on the page — same
 * shape as delay-summary-cache.ts, so a table with 50 rows fires one
 * request instead of 50. `undefined` = not yet resolved, `null` = resolved,
 * not in any active delivery.
 */
const cache = new Map<string, DeliverySummary | null>();
const subscribers = new Map<string, Set<() => void>>();
const pending = new Set<string>();
const inFlight = new Set<string>();
// Bumped on every write to `cache` for an issueId — see delay-summary-cache.ts
// for the full rationale (a stale in-flight batch response is discarded if
// something fresher, usually a local optimistic patch, already won). Every
// read normalizes a missing entry to 0 via versionOf() rather than comparing
// against a raw `undefined`, so a brand-new issueId's first flush is never
// mistaken for "stale".
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

// Separate from the per-issue `subscribers` above: issue-list pages (Project
// Tracking, My Tasks, Global Search, Team Pulse, board columns) render a
// Delivery column baked into their own fetched row data, not through
// useDeliverySummary — so patching the per-issue cache alone never touches
// them. Next.js Tabs keeps every project tab mounted at once (no unmount on
// switch), so a mutation made on the Delivery Tracking tab previously had no
// way to reach an already-mounted Project Tracking tab's stale rows at all,
// even after switching to it. Any real mutation notifies this list too, so
// every subscribed page just re-runs its own load function.
const listChangeSubscribers = new Set<() => void>();

/** Subscribe to "some delivery's data changed somewhere" — call your existing load/refetch function. Returns an unsubscribe function. */
export function subscribeToDeliveryListChanges(callback: () => void): () => void {
  listChangeSubscribers.add(callback);
  return () => listChangeSubscribers.delete(callback);
}

function notifyListChanged() {
  for (const cb of listChangeSubscribers) cb();
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
    const res = await fetch("/api/deliveries/summaries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issueIds: batch }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { summaries } = (await res.json()) as DeliverySummariesResponse;
    for (const issueId of batch) {
      if (versionOf(issueId) !== sentVersions.get(issueId)) continue;
      cache.set(issueId, summaries[issueId] ?? null);
      bump(issueId);
      notify(issueId);
    }
  } catch (e) {
    console.warn("[delivery-summary-cache] batch fetch failed:", e);
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
 * Recomputes an issue's delivery summary from its full membership list
 * (already in memory inside the item panel right after add/remove/status
 * change) and pushes it into the shared cache — every badge showing that
 * issue updates immediately, no refetch needed. Mirrors the "nearest
 * delivery" resolution the server's fetchDeliverySummaries uses, so the
 * badge never disagrees with a fresh page load.
 */
export function patchDeliverySummary(
  issueId: string,
  memberships: { deliveryId: string; deliveryName: string; deliveryDate: string; projectId: string; status: DeliverySummary["status"] }[]
) {
  if (memberships.length === 0) {
    cache.set(issueId, null);
    bump(issueId);
    notify(issueId);
    notifyListChanged();
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = memberships.filter((m) => m.deliveryDate >= today).sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
  const overdue = memberships.filter((m) => m.deliveryDate < today).sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate));
  const nearest = upcoming[0] ?? overdue[0];
  cache.set(issueId, {
    deliveryId: nearest.deliveryId,
    deliveryName: nearest.deliveryName,
    deliveryDate: nearest.deliveryDate,
    projectId: nearest.projectId,
    status: nearest.status,
    isOverdue: nearest.deliveryDate < today,
    totalDeliveries: memberships.length,
  });
  bump(issueId);
  notify(issueId);
  notifyListChanged();
}

/**
 * Refetches an issue's full delivery membership list and patches the shared
 * cache — for callers that just attached/created a delivery for this issue
 * from outside the item panel (e.g. `AddToDeliveryMenu`'s quick-attach),
 * where the full membership list isn't already in memory to pass to
 * `patchDeliverySummary` directly. Without this, every badge showing this
 * issue keeps its stale "not in any delivery" cache entry until something
 * else happens to remount it.
 */
export async function refreshDeliverySummary(issueId: string): Promise<void> {
  try {
    // no-store: this function exists specifically to refresh after a
    // mutation — the browser's default cache mode would otherwise happily
    // serve the pre-mutation response for this exact URL, defeating the
    // entire point of calling it.
    const res = await fetch(`/api/deliveries/for-issue/${issueId}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const detail = (await res.json()) as { memberships: Parameters<typeof patchDeliverySummary>[1] };
    patchDeliverySummary(issueId, detail.memberships);
  } catch (e) {
    console.warn("[delivery-summary-cache] refresh failed:", e);
  }
}

/** `undefined` while unresolved, `null` once confirmed not in any delivery, else the summary. */
export function useDeliverySummary(issueId: string): DeliverySummary | null | undefined {
  const subscribeForIssue = useCallback(
    (callback: () => void) => subscribe(issueId, callback),
    [issueId]
  );
  return useSyncExternalStore(subscribeForIssue, () => cache.get(issueId), () => undefined);
}
