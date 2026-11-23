"use client";

/**
 * State of one open movement panel. The view (summaries, signers, permissions) and the checklist
 * (the one big payload) are separate requests held in one place; every request has an
 * AbortController and a sequence number so a slow, older answer never overwrites a newer one.
 * The checklist is fetched only when something shows it (`wantChecklist`: the Checklist / Branches tab is
 * open, or the user can sign), once per hash, never on every view poll.
 * The refresh (reads Jira comments, can take a minute) is a state machine with polling (4 s, then 8 s, then
 * 15 s: logic.ts) when the server says another refresh is running or the call times out. The view's own
 * `refreshing` flag (a refresh started by someone else or in another tab) is watched the same way, and
 * `receivedAt` lets the header measure ages on the server's clock (`serverNow`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, movementBase } from "./api";
import type { Checklist, MovementView, RefreshResult } from "./api-types";
import { checklistWanted, MAX_HASH_RELOADS, pollVerdict, refreshPollCount, refreshPollDelay } from "./logic";
import { needsAutoRefresh } from "./view-model";

/** Longer than a normal refresh, shorter than the server's 300 s: past it we poll instead of waiting. */
export const REFRESH_TIMEOUT_MS = 110_000;
/** The server's own cap on one refresh; polling past it is pointless. */
const REFRESH_CAP_MS = 300_000;
let requestCounter = 0;

export interface RefreshUi {
  phase: "idle" | "running" | "error";
  message: string | null;
  startedAt: number | null;
  auto: boolean;
}
const IDLE: RefreshUi = { phase: "idle", message: null, startedAt: null, auto: false };

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true }
    );
  });
}

export function useMovement(deliveryId: string, movementId: string, open: boolean, wantChecklist: boolean) {
  const base = movementBase(deliveryId, movementId);
  const [view, setView] = useState<MovementView | null>(null);
  /** Browser timestamp of the moment `view` arrived (see serverNowAt). */
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [checklist, setChecklistState] = useState<Checklist | null>(null);
  /** The loaded checklist, readable from callbacks (ensureChecklist) without waiting for a render. */
  const checklistRef = useRef<Checklist | null>(null);
  const setChecklist = useCallback((c: Checklist | null) => {
    checklistRef.current = c;
    setChecklistState(c);
  }, []);
  const onDemandCtl = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** HTTP status of the failed view load (404: the movement is gone; 401: the session). */
  const [loadStatus, setLoadStatus] = useState<number | null>(null);
  const [checklistError, setChecklistError] = useState<string | null>(null);
  const [checklistTry, setChecklistTry] = useState(0);
  const [refreshUi, setRefreshUi] = useState<RefreshUi>(IDLE);
  /** The watcher stopped waiting for a refresh the server still reports as running. */
  const [watchGaveUp, setWatchGaveUp] = useState(false);

  const viewSeq = useRef(0);
  const viewCtl = useRef<AbortController | null>(null);
  const viewRef = useRef<MovementView | null>(null);
  const checklistFetchedFor = useRef<string | null>(null);
  const mismatchReloads = useRef(0);
  const refreshCtl = useRef<AbortController | null>(null);
  const refreshing = useRef(false);
  const autoDone = useRef(false);

  const loadView = useCallback(async (): Promise<MovementView | null> => {
    viewCtl.current?.abort();
    const ctl = new AbortController();
    viewCtl.current = ctl;
    const seq = ++requestCounter;
    viewSeq.current = seq;
    const r = await api<MovementView>(base, { signal: ctl.signal, timeoutMs: 30_000, fallbackError: "Could not load the movement" });
    if (seq !== viewSeq.current || r.aborted) return null;
    setLoading(false);
    if (!r.ok || !r.data) {
      setLoadError(r.error ?? "Could not load the movement");
      setLoadStatus(r.status);
      return null;
    }
    setLoadError(null);
    setLoadStatus(null);
    viewRef.current = r.data;
    setReceivedAt(Date.now());
    setView(r.data);
    return r.data;
  }, [base]);

  // First load on open; everything is dropped on close so a reopen starts clean.
  useEffect(() => {
    if (!open) return;
    autoDone.current = false;
    checklistFetchedFor.current = null;
    mismatchReloads.current = 0;
    void loadView();
    return () => {
      viewSeq.current = 0;
      viewCtl.current?.abort();
      refreshCtl.current?.abort();
      onDemandCtl.current?.abort();
      refreshing.current = false;
    };
  }, [open, loadView]);

  // The checklist follows the view's hash: fetched once per hash, and only when it is shown or needed to sign.
  const hash = view?.movement.hash ?? null;
  // Unreadable stored inputs: the endpoint would answer 409 inputs_stale, so it is not even asked (the panel says "re-read first").
  const needsRefresh = !!view?.needsRefresh;
  const needChecklist = checklistWanted(wantChecklist, view);
  useEffect(() => {
    if (!open || !needChecklist || !hash || needsRefresh || checklistFetchedFor.current === hash) return;
    checklistFetchedFor.current = hash;
    const ctl = new AbortController();
    let finished = false;
    api<{ checklist: Checklist }>(`${base}/checklist`, { signal: ctl.signal, timeoutMs: 60_000, fallbackError: "Could not load the checklist" }).then((r) => {
      if (ctl.signal.aborted || r.aborted) return;
      finished = true;
      if (!r.ok || !r.data) {
        checklistFetchedFor.current = null; // let a retry fetch again
        // 409 inputs_stale: the view just did not know yet; reload it so it reports needsRefresh instead of an error.
        if (r.status === 409 && (r.body as { code?: unknown } | null)?.code === "inputs_stale") {
          setChecklistError(null);
          void loadView();
          return;
        }
        setChecklistError(r.error ?? "Could not load the checklist");
        return;
      }
      setChecklistError(null);
      setChecklist(r.data.checklist);
      if (r.data.checklist.hash === hash) {
        mismatchReloads.current = 0;
        return;
      }
      // The server moved on between the two requests: take the newer view (its hash differs, so the next fetch follows),
      // but only a couple of times: a checklist that keeps changing under us ends in a visible error, not a loop.
      if (mismatchReloads.current >= MAX_HASH_RELOADS) {
        checklistFetchedFor.current = null;
        setChecklistError("The checklist keeps changing while it loads. Try again in a moment.");
        return;
      }
      mismatchReloads.current++;
      void loadView();
    });
    return () => {
      ctl.abort();
      // Aborted before it answered: the next run for this hash must fetch again.
      if (!finished && checklistFetchedFor.current === hash) checklistFetchedFor.current = null;
    };
  }, [open, needChecklist, hash, needsRefresh, base, loadView, checklistTry, setChecklist]);

  /**
   * The checklist for something the user asked for (Copy): the one already loaded when it is the current one, else fetched now. It shares the
   * per-hash cache (what it loads is shown by the tabs too, and the automatic fetch will not repeat it), is abortable (the page closing aborts
   * it) and never needs a tab to be open. `stale`: 409 inputs_stale, the stored data must be re-read first.
   */
  const ensureChecklist = useCallback(async (): Promise<{ ok: true; checklist: Checklist } | { ok: false; message: string; stale: boolean }> => {
    const have = checklistRef.current;
    const hashNow = viewRef.current?.movement.hash ?? null;
    if (have && (hashNow === null || have.hash === hashNow)) return { ok: true, checklist: have };
    onDemandCtl.current?.abort();
    const ctl = new AbortController();
    onDemandCtl.current = ctl;
    const r = await api<{ checklist: Checklist }>(`${base}/checklist`, { signal: ctl.signal, timeoutMs: 60_000, fallbackError: "Could not load the checklist" });
    if (r.aborted) return { ok: false, message: "Cancelled", stale: false };
    if (!r.ok || !r.data) return { ok: false, message: r.error ?? "Could not load the checklist", stale: r.status === 409 && (r.body as { code?: unknown } | null)?.code === "inputs_stale" };
    checklistFetchedFor.current = r.data.checklist.hash; // the automatic fetch for this hash is not needed any more
    setChecklist(r.data.checklist);
    return { ok: true, checklist: r.data.checklist };
  }, [base, setChecklist]);

  const retryChecklist = useCallback(() => {
    checklistFetchedFor.current = null;
    mismatchReloads.current = 0;
    setChecklistError(null);
    setChecklistTry((n) => n + 1);
  }, []);

  /** The checklist is wanted and being fetched (the view is newer than the one shown). */
  const checklistLoading = needChecklist && !!hash && !needsRefresh && checklist?.hash !== hash && !checklistError;

  /** Polls the view (4 s, 8 s, 15 s apart) until the refresh that began at `before` is over; "gaveup" after the server's 5-minute cap. */
  const pollUntilRefreshed = useCallback(
    async (before: { refreshedAt: string | null; refreshError: string | null }, signal: AbortSignal): Promise<{ verdict: "done" | "failed" | "gaveup"; error: string | null }> => {
      let quiet = 0;
      const tries = refreshPollCount(REFRESH_CAP_MS);
      for (let i = 0; i < tries && !signal.aborted; i++) {
        await sleep(refreshPollDelay(i), signal);
        if (signal.aborted) break;
        const v = await loadView();
        if (!v) continue;
        quiet = !v.refreshing && v.movement.refreshedAt === before.refreshedAt ? quiet + 1 : 0;
        const verdict = pollVerdict({ refreshing: v.refreshing, refreshedAt: v.movement.refreshedAt, refreshError: v.refreshError }, before, quiet);
        if (verdict !== "continue") return { verdict, error: v.refreshError };
      }
      return { verdict: "gaveup", error: null };
    },
    [loadView]
  );

  const refresh = useCallback(
    async (auto = false): Promise<void> => {
      if (refreshing.current) return;
      refreshing.current = true;
      const ctl = new AbortController();
      refreshCtl.current = ctl;
      const before = { refreshedAt: viewRef.current?.movement.refreshedAt ?? null, refreshError: viewRef.current?.refreshError ?? null };
      setWatchGaveUp(false);
      setRefreshUi({ phase: "running", message: null, startedAt: Date.now(), auto });
      try {
        const r = await api<RefreshResult>(`${base}/refresh`, { method: "POST", signal: ctl.signal, timeoutMs: REFRESH_TIMEOUT_MS, fallbackError: "The refresh failed" });
        if (r.aborted) return;
        if (r.ok && r.data && !r.data.refreshing) {
          await loadView();
          setRefreshUi(IDLE);
          return;
        }
        if ((r.ok && r.data?.refreshing) || r.timedOut) {
          const out = await pollUntilRefreshed(before, ctl.signal);
          if (ctl.signal.aborted) return;
          if (out.verdict === "done") setRefreshUi(IDLE);
          else if (out.verdict === "failed") setRefreshUi({ phase: "error", message: `The refresh failed${out.error ? `: ${out.error}` : ""}`, startedAt: null, auto });
          else
            setRefreshUi({
              phase: "error",
              message: r.timedOut ? "Reading the Jira comments is taking longer than expected. It may still finish; try Refresh again in a minute." : "Another refresh is still running. Try again in a minute.",
              startedAt: null,
              auto,
            });
          return;
        }
        const detail = (r.body as { error?: unknown } | null)?.error;
        setRefreshUi({ phase: "error", message: r.error ?? (typeof detail === "string" ? detail : "The refresh failed"), startedAt: null, auto });
      } finally {
        refreshing.current = false;
      }
    },
    [base, loadView, pollUntilRefreshed]
  );

  // Auto-refresh once per open when the data is older than 30 minutes (on the server's clock) or unreadable, unless one is already running.
  useEffect(() => {
    if (!open || !view || autoDone.current) return;
    autoDone.current = true;
    if (view.refreshing) return;
    const serverNow = Date.parse(view.serverNow);
    const now = Number.isNaN(serverNow) ? Date.now() : serverNow;
    // Jiras added to (or removed from) the delivery since the last sync are brought in at once, whatever the age of the data.
    const deliveryMoved = (view.deliveryChanged?.added ?? 0) + (view.deliveryChanged?.removed ?? 0) > 0;
    if (view.needsRefresh || deliveryMoved ? view.permissions.refresh : needsAutoRefresh(view.movement.refreshedAt, now, view.permissions.refresh)) void refresh(true);
  }, [open, view, refresh]);

  // A refresh this browser did not start (another user, another tab): watch the view until it is over; if it is
  // still "running" after the server's cap, say so instead of keeping the banner up for ever.
  const serverRefreshing = !!view?.refreshing;
  useEffect(() => {
    if (!serverRefreshing || !open || refreshing.current) return;
    const ctl = new AbortController();
    void (async () => {
      setWatchGaveUp(false); // a new refresh on the server: wait for it afresh
      const tries = refreshPollCount(REFRESH_CAP_MS);
      for (let i = 0; i < tries && !ctl.signal.aborted; i++) {
        await sleep(refreshPollDelay(i), ctl.signal);
        if (ctl.signal.aborted) return;
        const v = await loadView();
        if (v && !v.refreshing) {
          setWatchGaveUp(false);
          if (v.refreshError) setRefreshUi({ phase: "error", message: `The refresh failed: ${v.refreshError}`, startedAt: null, auto: false });
          return;
        }
      }
      if (ctl.signal.aborted) return;
      setWatchGaveUp(true);
      setRefreshUi({ phase: "error", message: "A refresh has been running for over 5 minutes and may have stalled. Try Refresh again later.", startedAt: null, auto: false });
    })();
    return () => ctl.abort();
  }, [open, serverRefreshing, loadView]);

  return {
    view,
    checklist,
    loading,
    loadError,
    loadStatus,
    checklistLoading,
    checklistError,
    refreshUi,
    /** A refresh the server reports as running that this page is still waiting for (false once the watcher gave up). */
    serverRefreshing: serverRefreshing && !watchGaveUp,
    refresh,
    reload: loadView,
    retryChecklist,
    ensureChecklist,
    dismissRefreshError: () => setRefreshUi(IDLE),
    receivedAt,
  };
}
