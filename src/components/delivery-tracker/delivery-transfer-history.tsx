"use client";

import { useEffect, useState } from "react";
import { RiArrowRightLine } from "@remixicon/react";
import { Skeleton } from "@/components/ui/skeleton";
import type { DeliveryTransferEntry } from "@/lib/deliveries/entries";
import type { DeliveryTransferHistoryResponse } from "@/app/api/deliveries/transfers/[issueId]/route";

/**
 * Every time this issue was moved between deliveries — a pure read, no
 * edit/delete affordance, matching DeletedHistoryRow's read-only styling in
 * the sibling delays tab. Lives in delay-tracker/ (its only caller) even
 * though the data is delivery-domain, mirroring the existing cross-feature
 * reuse already in this codebase (DelayLogButton embedded inside the
 * delivery-management popup).
 */
export function DeliveryTransferHistory({ issueId }: { issueId: string }) {
  const [transfers, setTransfers] = useState<DeliveryTransferEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/deliveries/transfers/${issueId}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: DeliveryTransferHistoryResponse) => setTransfers(d.transfers))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => controller.abort();
  }, [issueId]);

  if (!transfers && !error) return <TransferHistorySkeleton />;
  if (error && !transfers) return <p className="text-xs text-destructive">Failed to load: {error}</p>;

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-destructive">Refresh failed: {error}</p>}
      {transfers && transfers.length === 0 && (
        <p className="text-xs text-muted-foreground">This issue has never been moved between deliveries.</p>
      )}
      {transfers?.map((t) => <TransferRow key={t.id} transfer={t} />)}
    </div>
  );
}

function TransferRow({ transfer }: { transfer: DeliveryTransferEntry }) {
  return (
    <div className="rounded-lg border border-border/60 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-medium text-foreground">{transfer.fromDeliveryName}</span>
        <span className="text-muted-foreground/70">({transfer.fromDeliveryDate})</span>
        <RiArrowRightLine className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">{transfer.toDeliveryName}</span>
        <span className="text-muted-foreground/70">({transfer.toDeliveryDate})</span>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground/70">
        Moved by {transfer.movedByName ?? transfer.movedBy} on {formatDateTime(transfer.movedAt)}
      </p>
    </div>
  );
}

function TransferHistorySkeleton() {
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
