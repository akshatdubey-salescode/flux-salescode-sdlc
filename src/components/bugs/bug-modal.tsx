"use client";

// Shared modal shell for the bug board's drill-downs (breakdown tabs,
// project Jira list, missing-owner list) — larger than the shared Dialog's
// sm:max-w-sm default. Closes on outside click same as any other Dialog
// (no onPointerDownOutside override) — not a change to the shared Dialog
// component itself, that would silently affect every other modal in the app;
// this wraps it locally.
//
// DialogContent has its own p-4 padding, so a header that's sticky *and*
// meant to touch the very top edge can't just cancel that with a negative
// margin — negative margins and position:sticky don't reliably combine
// across browsers, and the base close button (absolute top-2 right-2, no
// z-index of its own) ends up hidden underneath a full-width sticky header
// regardless. So: strip DialogContent's own padding entirely (p-0), give the
// header and body their own padding instead, and render this modal's own
// close button *inside* the sticky header — same stacking layer, no
// conflict, and the header can genuinely start flush at the top edge.
import type { ReactNode } from "react";
import { RiCloseLine } from "@remixicon/react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function BugModal({
  trigger,
  title,
  children,
  open,
  onOpenChange,
  className,
}: {
  trigger?: ReactNode;
  title: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        className={cn("max-h-[85vh] max-w-3xl overflow-y-auto p-0 sm:max-w-3xl", className)}
        showCloseButton={false}
      >
        <DialogHeader className="sticky top-0 z-10 min-w-0 flex-row items-center justify-between gap-3 border-b border-border/50 bg-popover px-4 py-3">
          <DialogTitle className="min-w-0 truncate">{title}</DialogTitle>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" className="shrink-0">
              <RiCloseLine />
              <span className="sr-only">Close</span>
            </Button>
          </DialogClose>
        </DialogHeader>
        <div className="min-w-0 px-4 pb-4">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
