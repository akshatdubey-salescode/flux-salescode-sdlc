/**
 * The small state machines of the movement UI, pure (no React, no fetch, timers injected) so they are tested
 * with node:test: the refresh polling schedule and verdict, the tick batcher, how a failed call is classified,
 * and the delivery filter with its "keep the open one" rule.
 */
import { isStaleHash, refreshNeededCode, slotFromError, type ApiErrorBody } from "./view-model";
import type { MovementSlot } from "@/lib/movement/values";

// ---------------------------------------------------------------------------------------------
// refresh polling
// ---------------------------------------------------------------------------------------------

/** Wait before poll number `attempt` (0-based): 4 s for the first 5 polls, 8 s for the next 5, then 15 s. A long refresh must not hammer the view. */
export function refreshPollDelay(attempt: number): number {
  if (attempt < 5) return 4_000;
  if (attempt < 10) return 8_000;
  return 15_000;
}

/** How many polls fit in `maxMs` (the server's refresh cap is 5 minutes). */
export function refreshPollCount(maxMs: number): number {
  let n = 0;
  let t = 0;
  while (t + refreshPollDelay(n) <= maxMs) t += refreshPollDelay(n++);
  return n;
}

export type PollVerdict = "continue" | "done" | "failed";

/**
 * What one poll of the view says about a refresh that started when the view read `before`.
 * - still `refreshing`: keep going;
 * - a refreshError that was not there before, or a changed refreshedAt carrying one: failed (surface the error);
 * - refreshedAt moved: done;
 * - not refreshing and nothing changed for `quietPolls` polls in a row (a refresh that found nothing, or ran on another instance): done.
 */
export function pollVerdict(
  v: { refreshing: boolean; refreshedAt: string | null; refreshError: string | null },
  before: { refreshedAt: string | null; refreshError: string | null },
  quietPolls: number
): PollVerdict {
  if (v.refreshing) return "continue";
  if (v.refreshError && v.refreshError !== before.refreshError) return "failed";
  if (v.refreshedAt !== before.refreshedAt) return v.refreshError ? "failed" : "done";
  return quietPolls >= 2 ? "done" : "continue";
}

// ---------------------------------------------------------------------------------------------
// which payloads the panel needs
// ---------------------------------------------------------------------------------------------

/**
 * Is the (big) checklist payload needed? When a tab shows it (Checklist, Branches: the record's branch hints), or when the
 * user can sign: Sign is enabled only for the checklist that is on screen, so a signer arriving from the notification email
 * must get it on the first tab, without having to open the Checklist tab.
 */
export function checklistWanted(tabShowsIt: boolean, view: { permissions: { sign: readonly unknown[] } } | null | undefined): boolean {
  return tabShowsIt || (view?.permissions.sign.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------------------------
// tick batching
// ---------------------------------------------------------------------------------------------

export interface TickBatcher {
  /** Remember the latest choice per Jira and (re)start the quiet period. */
  push(ids: readonly string[], included: boolean): void;
  /** Send what is pending now (also what the timer does). Resolves when everything pending has been answered. */
  flush(): Promise<void>;
  /** Drop what is pending without sending. */
  cancel(): void;
  readonly pending: number;
}

export const TICK_BATCH_MS = 300;
const MAX_TICK_IDS = 200;

/**
 * Consecutive tick changes within `delayMs` become ONE PATCH per direction (the server takes up to 200 ids and
 * `included` once): the last choice per Jira wins, ticks go first, then unticks, sequentially so two PATCHes never race.
 * `send` resolves true when the server accepted; `settled` tells the UI which ids were answered (to drop the optimistic state).
 */
export function createTickBatcher(opts: {
  delayMs?: number;
  send: (ids: string[], included: boolean) => Promise<boolean>;
  settled?: (ids: string[], included: boolean, ok: boolean) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}): TickBatcher {
  const delay = opts.delayMs ?? TICK_BATCH_MS;
  const setT = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let pending = new Map<string, boolean>();
  let timer: unknown = null;
  let chain: Promise<void> = Promise.resolve();

  function flush(): Promise<void> {
    if (timer !== null) {
      clearT(timer);
      timer = null;
    }
    if (pending.size === 0) return chain;
    const taken = pending;
    pending = new Map();
    const run = async () => {
      for (const included of [true, false]) {
        const ids = [...taken].filter(([, v]) => v === included).map(([id]) => id);
        for (let i = 0; i < ids.length; i += MAX_TICK_IDS) {
          const chunk = ids.slice(i, i + MAX_TICK_IDS);
          let ok = false;
          try {
            ok = await opts.send(chunk, included);
          } catch {
            ok = false;
          }
          opts.settled?.(chunk, included, ok);
        }
      }
    };
    chain = chain.then(run, run);
    return chain;
  }

  return {
    push(ids, included) {
      for (const id of ids) pending.set(id, included);
      if (timer !== null) clearT(timer);
      timer = setT(() => {
        timer = null;
        void flush();
      }, delay);
    },
    flush,
    cancel() {
      if (timer !== null) clearT(timer);
      timer = null;
      pending = new Map();
    },
    get pending() {
      return pending.size;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// a failed call
// ---------------------------------------------------------------------------------------------

/** What a mutation gives back: the data, or a failure that says whether the UI already told the user. */
export type MutateResult<T> = { ok: true; data: T | null } | { ok: false; reported: boolean; message: string; slot: MovementSlot | null };

export type FailureKind = "stale_hash" | "refresh_needed" | "plain";

export interface FailureInfo {
  kind: FailureKind;
  /** The server may have acted, or the state moved on: reload the view (and the card's chip) before returning. */
  reload: boolean;
  slot: MovementSlot | null;
}

/**
 * Classifies a failed call. A request that may have reached the server (timeout, no answer, 5xx) or that says the
 * state moved on (403, 409) must reload the view so the buttons match reality; a plain 4xx validation error does not.
 */
export function classifyFailure(r: { status: number; timedOut: boolean; body: ApiErrorBody | null }): FailureInfo {
  const kind: FailureKind = isStaleHash(r.status, r.body) ? "stale_hash" : refreshNeededCode(r.status, r.body) ? "refresh_needed" : "plain";
  const mayHaveReached = r.timedOut || r.status === 0 || r.status >= 500;
  return { kind, reload: kind !== "plain" || mayHaveReached || r.status === 409 || r.status === 403, slot: slotFromError(r.body) };
}

/** Number of reloads a hash-mismatch may trigger before the panel stops and says so (N7). */
export const MAX_HASH_RELOADS = 2;

// ---------------------------------------------------------------------------------------------
// delivery filter
// ---------------------------------------------------------------------------------------------

export interface FilterableDelivery {
  id: string;
  completedAt: string | null;
  deliveryDate: string;
  items: ReadonlyArray<{ status: string }>;
}

export interface DeliveryFilters {
  showCompleted: boolean;
  dateFrom: string | null;
  dateTo: string | null;
  query: string;
  statusFilter: ReadonlySet<string>;
  /** Deliveries that stay in the list whatever the filters say (a deep-linked one, the one whose movement panel is open). */
  pinned: ReadonlySet<string>;
}

/**
 * The Delivery tab's filter. A pinned delivery always stays: confirming statuses inside an open movement panel changes
 * item statuses, which could make the item-status filter hide the delivery and unmount the panel under the user.
 */
export function filterDeliveries<T extends FilterableDelivery>(list: readonly T[], f: DeliveryFilters, matchesSearch: (d: T, q: string) => boolean): Array<T & { visibleItems: T["items"] }> {
  const query = f.query.trim();
  return list
    .filter((d) => {
      if (f.pinned.has(d.id)) return true;
      if (!f.showCompleted && d.completedAt) return false;
      if (f.dateFrom && d.deliveryDate < f.dateFrom) return false;
      if (f.dateTo && d.deliveryDate > f.dateTo) return false;
      if (query && !matchesSearch(d, query)) return false;
      return true;
    })
    .map((d) => ({ ...d, visibleItems: f.statusFilter.size === 0 ? d.items : d.items.filter((i) => f.statusFilter.has(i.status)) }))
    .filter((d) => f.statusFilter.size === 0 || d.visibleItems.length > 0 || f.pinned.has(d.id));
}
