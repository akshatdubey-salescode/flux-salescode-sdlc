"use client";

import { useState } from "react";
import { RiSearchEyeLine } from "@remixicon/react";
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
import { useRcaSummary } from "./rca-summary-cache";

/**
 * The single reusable "RCA given/not given" entry point, dropped into every
 * bug-issue-list surface — same pattern as DelayLogButton/DeliveryBadge.
 * Renders nothing until the shared batched cache (useRcaSummary) resolves,
 * and renders nothing at all for a non-bug issue (RCA doesn't apply) so
 * every call site can render this unconditionally, exactly like the other
 * two badges, with no per-site "is this a bug" check needed.
 */
export function RcaBadge({ issueId }: { issueId: string }) {
  const [open, setOpen] = useState(false);
  const summary = useRcaSummary(issueId);

  // undefined = still loading (render nothing rather than flash a wrong
  // state); null = not a bug, doesn't apply — also nothing.
  if (summary == null) return null;

  const icon = (
    <RiSearchEyeLine
      className={cn(
        "size-3.5",
        summary.given ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
      )}
    />
  );
  const tooltipText = summary.given ? "RCA given" : "RCA not given";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/*
        Not a DialogTrigger — same reasoning as DelayLogButton/DeliveryBadge:
        this sits inside rows that are themselves clickable (Jira deep-links,
        kanban cards), so the open-toggle is driven directly with
        preventDefault/stopPropagation instead of letting the click bubble.
      */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="View RCA"
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
          <DialogTitle>RCA</DialogTitle>
          <DialogDescription>Root cause analysis entered on this issue in Jira.</DialogDescription>
        </DialogHeader>
        <p className="whitespace-pre-wrap text-sm text-foreground">
          {summary.text ?? <span className="text-muted-foreground">RCA not given for this issue.</span>}
        </p>
      </DialogContent>
    </Dialog>
  );
}
