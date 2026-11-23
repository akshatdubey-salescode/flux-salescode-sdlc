"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "./api";
import type { EventsPage, MovementEventRow, MovementView } from "./api-types";
import { eventDetail, eventLabel, formatIst, mergeEvents, mergeFirstPage } from "./view-model";

const PAGE = 20;

/**
 * The audit trail, newest first, 20 per page: GET events?limit&before with the opaque `nextBefore`
 * cursor behind "Load more". When the movement changes (`refreshKey` = the view's updatedAt) only the FIRST page is
 * fetched again and merged on top, so pages the user already loaded stay.
 * If the history cannot be fetched, the 20 latest events the view already carries are shown instead.
 */
export function MovementEvents({ eventsBase, refreshKey, initial }: { eventsBase: string; refreshKey: string; initial: MovementView["events"] }) {
  // One state object so the rows and their cursor always change together.
  const [list, setList] = useState<{ events: MovementEventRow[]; next: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const seq = useRef(0);
  const ctl = useRef<AbortController | null>(null);
  const events = list?.events ?? null;
  const next = list?.next ?? null;

  useEffect(() => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    const mine = ++seq.current;
    api<EventsPage>(`${eventsBase}?limit=${PAGE}`, { signal: c.signal, timeoutMs: 30_000, fallbackError: "Could not load the history" }).then((r) => {
      if (mine !== seq.current || r.aborted) return;
      if (!r.ok || !r.data) {
        setError(r.error ?? "Could not load the history");
        return;
      }
      setError(null);
      const page = r.data;
      // First load: the page. A later reload: the fresh first page on top, everything already loaded (more pages) stays below.
      setList((prev) => (prev ? mergeFirstPage(prev.events, prev.next, page.events, page.nextBefore) : { events: page.events, next: page.nextBefore }));
    });
    return () => c.abort();
  }, [eventsBase, refreshKey]);

  const loadMore = useCallback(async () => {
    if (!next || moreBusy) return;
    setMoreBusy(true);
    const mine = seq.current;
    const r = await api<EventsPage>(`${eventsBase}?limit=${PAGE}&before=${encodeURIComponent(next)}`, { timeoutMs: 30_000, fallbackError: "Could not load more history" });
    setMoreBusy(false);
    if (mine !== seq.current || r.aborted) return; // the first page was reloaded meanwhile: this page belongs to an older cursor
    if (!r.ok || !r.data) {
      setError(r.error ?? "Could not load more history");
      return;
    }
    setError(null);
    const page = r.data;
    setList((prev) => (prev ? { events: mergeEvents(prev.events, page.events), next: page.nextBefore } : prev));
  }, [eventsBase, next, moreBusy]);

  const fallback = events === null && error !== null;
  const rows: Array<{ key: string; at: string; type: string; actorName: string | null; detail: unknown }> = fallback
    ? initial.map((e, i) => ({ key: `${e.at}-${i}`, at: e.at, type: e.type, actorName: e.actorName, detail: null }))
    : (events ?? []).map((e) => ({ key: e.id, at: e.at, type: e.type, actorName: e.actorName, detail: e.detail }));

  return (
    <section className="rounded-lg border border-border" data-testid="movement-events">
      <h3 className="border-b border-border px-2 py-1.5 text-xs font-semibold">History{events ? ` (${events.length}${next ? "+" : ""})` : ""}</h3>
      {error && (
        <p role="alert" className="px-2 pt-1.5 text-xs text-destructive" data-testid="movement-events-error">
          {error}
          {fallback ? " Showing the latest events the page already has." : ""}
        </p>
      )}
      {events === null && !error && <p className="p-2 text-xs text-muted-foreground">Loading the history…</p>}
      {(events !== null || fallback) && (
        <div role="table" aria-label="Movement history" id="movement-events-body" className="text-xs">
          <div role="row" className="hidden grid-cols-[130px_minmax(100px,0.7fr)_minmax(0,2fr)] gap-x-2 border-b border-border bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground md:grid">
            <span role="columnheader">When</span>
            <span role="columnheader">Who</span>
            <span role="columnheader">What</span>
          </div>
          {rows.length === 0 && <p className="p-2 text-muted-foreground">No events yet.</p>}
          {rows.map((e, n) => {
            const detail = eventDetail(e.type, e.detail);
            return (
              <div key={e.key} role="row" className="grid min-h-8 grid-cols-1 items-baseline gap-x-2 border-b border-border px-2 py-1 last:border-b-0 odd:bg-muted/20 md:grid-cols-[130px_minmax(100px,0.7fr)_minmax(0,2fr)]" data-testid={`movement-event-${n}`}>
                <span role="cell" className="text-muted-foreground">
                  {formatIst(e.at)}
                </span>
                <span role="cell" className="truncate text-muted-foreground" title={e.actorName ?? undefined}>
                  {e.actorName ?? "—"}
                </span>
                <span role="cell" className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="font-medium">{eventLabel(e.type)}</span>
                  {detail && <span className="text-muted-foreground"> · {detail}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {next && events !== null && (
        <div className="border-t border-border p-2">
          <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={moreBusy} onClick={() => void loadMore()} data-testid="movement-history-more">
            {moreBusy ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </section>
  );
}
