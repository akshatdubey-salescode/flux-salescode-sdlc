"use client";

import { useState } from "react";
import { RiAddCircleLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { CreateDeliveryForm } from "./create-delivery-form";
import { refreshDeliverySummary } from "./delivery-summary-cache";
import type { DeliveryOption } from "@/lib/deliveries/entries";

/**
 * Per-issue "add to delivery" entry point for Project Tracking rows/cards —
 * lists this project's existing deliveries (attach with one click) plus a
 * "+ New delivery" option that opens the same create form pre-attaching
 * this issue. The create dialog is rendered as a sibling, externally
 * controlled (not nested inside the popover's content) — Radix's Popover
 * and Dialog both manage outside-click/focus, and nesting a DialogTrigger
 * inside PopoverContent makes the two fight over who owns the dismissal.
 */
export function AddToDeliveryMenu({
  projectId,
  issueId,
  onChanged,
}: {
  projectId: string;
  issueId: string;
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<DeliveryOption[] | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function loadOptions() {
    setOptions(null);
    fetch(`/api/projects/${projectId}/deliveries?summary=1`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: { deliveries: DeliveryOption[] }) => setOptions(d.deliveries))
      .catch(() => setOptions([]));
  }

  async function handleAttach(deliveryId: string) {
    setAddingId(deliveryId);
    try {
      await fetch(`/api/deliveries/${deliveryId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueIds: [issueId] }),
      });
      setOpen(false);
      await refreshDeliverySummary(issueId);
      onChanged?.();
    } finally {
      setAddingId(null);
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        {/*
          Not a PopoverTrigger: Radix's composeEventHandlers skips its own
          open-toggle handler once the caller's onClick calls
          preventDefault(), which we need here so rows that wrap this button
          in a <Link> (board-view.tsx's IssueCard) don't navigate when the
          icon is clicked. So we drive `open` directly instead, using
          PopoverAnchor purely for positioning (same pattern as
          delay-log-button.tsx's DialogTrigger avoidance).
        */}
        <PopoverAnchor asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Add to delivery"
            aria-haspopup="dialog"
            aria-expanded={open}
            data-state={open ? "open" : "closed"}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen((o) => {
                const next = !o;
                if (next) loadOptions();
                return next;
              });
            }}
          >
            <RiAddCircleLine className="size-3.5" />
          </Button>
        </PopoverAnchor>
        <PopoverContent align="start" className="w-56 p-1" onClick={(e) => e.stopPropagation()}>
          {options === null ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p>
          ) : options.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No deliveries yet.</p>
          ) : (
            options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => handleAttach(o.id)}
                disabled={addingId === o.id}
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-muted/50 disabled:opacity-50"
              >
                <span className="truncate">{o.name}</span>
                <span className="ml-2 shrink-0 text-muted-foreground">{o.deliveryDate}</span>
              </button>
            ))
          )}
          <div className="mt-1 border-t border-border pt-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setShowCreate(true);
              }}
              className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-xs font-medium text-primary hover:bg-muted/50"
            >
              + New delivery
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <CreateDeliveryForm
        projectId={projectId}
        initialIssueId={issueId}
        open={showCreate}
        onOpenChange={setShowCreate}
        onSaved={async () => {
          setShowCreate(false);
          await refreshDeliverySummary(issueId);
          onChanged?.();
        }}
      />
    </>
  );
}
