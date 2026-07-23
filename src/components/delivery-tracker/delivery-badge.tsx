"use client";

import { useState } from "react";
import { RiTruckLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { deliveryStatusLabel, nearestDeliveryColorClass } from "@/lib/deliveries/status";
import { useDeliverySummary } from "./delivery-summary-cache";
import { DeliveryItemPanel } from "./delivery-item-panel";

/**
 * The single reusable entry point dropped into every issue-list surface,
 * mirroring <DelayLogButton>'s shape exactly: no data fetched until opened,
 * colored via the shared batched cache so it stays cheap with dozens on one
 * page. An issue can belong to several deliveries at once — the color/
 * tooltip reflect whichever is nearest (soonest upcoming, else most
 * recently overdue); opening the popup lists all of them.
 */
export function DeliveryBadge({
  issueId,
  canManage = false,
  onChanged,
}: {
  issueId: string;
  /** Shows a "Remove from this delivery" control in the popup — restricted to admins/delivery managers, same gate as every other delivery mutation. */
  canManage?: boolean;
  /** Fired after add/remove/status-change for this issue, so a caller with its own derived view can refetch/reconcile. */
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = useDeliverySummary(issueId);
  const hasDelivery = summary != null;

  const colorClass = hasDelivery ? nearestDeliveryColorClass(summary.status, summary.isOverdue) : undefined;

  const icon = <RiTruckLine className={cn("size-3.5", colorClass)} />;

  const tooltipText =
    summary === undefined
      ? "Checking delivery schedule…"
      : hasDelivery
        ? `${deliveryStatusLabel(summary.status)} · ${summary.deliveryName} · ${summary.deliveryDate}${summary.isOverdue && summary.status === "pending" ? " (overdue)" : ""}${summary.totalDeliveries > 1 ? ` · +${summary.totalDeliveries - 1} more` : ""}`
        : "No delivery scheduled";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Same manual-open-state approach as DelayLogButton — not a
          DialogTrigger, so this stays safe inside a row/card that's itself
          clickable (Jira deep-links, kanban cards). */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="View / manage delivery"
            aria-haspopup="dialog"
            aria-expanded={open}
            data-state={open ? "open" : "closed"}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(true);
            }}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent onClick={(e) => e.stopPropagation()}>{tooltipText}</TooltipContent>
      </Tooltip>
      <DialogContent className="max-w-lg sm:max-w-lg" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Delivery status</DialogTitle>
          <DialogDescription>Every delivery this issue is committed to, and its outcome.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          <DeliveryItemPanel issueId={issueId} canManage={canManage} onChanged={onChanged} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
