"use client";

import { useState } from "react";
import { RiAlarmWarningLine } from "@remixicon/react";
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
import { useDelaySummary } from "./delay-summary-cache";
import { DelayTrackerPanel } from "./delay-tracker-panel";

/**
 * The single reusable entry point dropped into every issue-list surface. No
 * data is fetched until the popup is actually opened — a row with this
 * button costs nothing beyond rendering an icon. The icon color and hover
 * summary come from the shared batched cache (`useDelaySummary`), so this
 * stays cheap even with dozens on one page. Always opens inline — only the
 * analytics drill-down pages navigate away, never this icon.
 */
export function DelayLogButton({
  issueId,
  onEntriesChanged,
}: {
  issueId: string;
  /** Fired after a create/update/delete for this issue, so a caller with its own derived view (e.g. a filtered issue table) can refetch/reconcile. */
  onEntriesChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = useDelaySummary(issueId);
  const hasDelay = summary != null;

  const icon = (
    <RiAlarmWarningLine
      className={cn(
        "size-3.5",
        hasDelay && (summary.allDeleted ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400")
      )}
    />
  );
  const tooltipText =
    summary === undefined
      ? "Checking for delays…"
      : hasDelay
        ? summary.allDeleted
          ? `${summary.count} delay${summary.count === 1 ? "" : "s"} logged (all since deleted) · most common: ${summary.topCategoryLabel} · latest ${summary.latestDelayDate}`
          : `${summary.count} delay${summary.count === 1 ? "" : "s"} · most common: ${summary.topCategoryLabel} · latest ${summary.latestDelayDate}`
        : "No delays logged";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/*
        Not a DialogTrigger: Radix's composeEventHandlers skips its own
        open-toggle handler once the caller's onClick calls preventDefault(),
        which we need here so rows that wrap this button in an <a> or another
        clickable container (Jira deep-links, expandable cards) don't
        navigate/toggle when the delay popup opens. So we drive `open`
        directly instead — and replicate the aria/data attributes
        DialogTrigger would otherwise have set, so screen readers still get
        "this button opens a dialog" + its current open/closed state.
      */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="View / log delays"
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
          <DialogTitle>Delay tracker</DialogTitle>
          <DialogDescription>Jira details and delay history for this issue.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          <DelayTrackerPanel issueId={issueId} onEntriesChanged={onEntriesChanged} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
