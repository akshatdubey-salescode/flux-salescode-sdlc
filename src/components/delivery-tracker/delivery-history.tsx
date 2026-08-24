"use client";

import { useEffect, useState } from "react";
import { RiArrowRightLine, RiExchangeLine } from "@remixicon/react";
import { Skeleton } from "@/components/ui/skeleton";
import { deliveryStatusLabel } from "@/lib/deliveries/status";
import type { DeliveryHistoryEvent } from "@/lib/deliveries/entries";
import type { DeliveryHistoryResponse } from "@/app/api/deliveries/history/[issueId]/route";

/**
 * Everything that happened to this issue's delivery commitment — migrations
 * between deliveries and status changes, merged into one chronological feed.
 * A pure read, no edit/delete affordance, matching DeletedHistoryRow's
 * read-only styling in the sibling delay-tracker popup.
 */
export function DeliveryHistory({ issueId }: { issueId: string }) {
  const [events, setEvents] = useState<DeliveryHistoryEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/deliveries/history/${issueId}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: DeliveryHistoryResponse) => setEvents(d.events))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => controller.abort();
  }, [issueId]);

  if (!events && !error) return <DeliveryHistorySkeleton />;
  if (error && !events) return <p className="text-xs text-destructive">Failed to load: {error}</p>;

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-destructive">Refresh failed: {error}</p>}
      {events && events.length === 0 && (
        <p className="text-xs text-muted-foreground">No delivery history for this issue yet.</p>
      )}
      {events?.map((e) =>
        e.type === "transfer" ? <TransferRow key={`t-${e.id}`} event={e} /> : <StatusChangeRow key={`s-${e.id}`} event={e} />
      )}
    </div>
  );
}

function TransferRow({ event }: { event: Extract<DeliveryHistoryEvent, { type: "transfer" }> }) {
  return (
    <div className="rounded-lg border border-border/60 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <RiExchangeLine className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">{event.fromDeliveryName}</span>
        <span className="text-muted-foreground/70">({event.fromDeliveryDate})</span>
        <RiArrowRightLine className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">{event.toDeliveryName}</span>
        <span className="text-muted-foreground/70">({event.toDeliveryDate})</span>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground/70">
        Moved by {event.movedByName ?? event.movedBy} on {formatDateTime(event.movedAt)}
      </p>
    </div>
  );
}

function StatusChangeRow({ event }: { event: Extract<DeliveryHistoryEvent, { type: "status_change" }> }) {
  return (
    <div className="rounded-lg border border-border/60 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {event.fromStatus ? (
          <>
            <span className="font-medium text-foreground">{deliveryStatusLabel(event.fromStatus)}</span>
            <RiArrowRightLine className="size-3 shrink-0 text-muted-foreground" />
          </>
        ) : null}
        <span className="font-medium text-foreground">{deliveryStatusLabel(event.toStatus)}</span>
        <span className="text-muted-foreground/70">in {event.deliveryName}</span>
      </div>
      {event.statusComment && <p className="mt-1 text-xs text-muted-foreground">{event.statusComment}</p>}
      <p className="mt-1 text-[10px] text-muted-foreground/70">
        Changed by {event.changedByName ?? event.changedBy} on {formatDateTime(event.changedAt)}
      </p>
    </div>
  );
}

function DeliveryHistorySkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-14 w-full rounded-lg" />
      <Skeleton className="h-14 w-full rounded-lg" />
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
