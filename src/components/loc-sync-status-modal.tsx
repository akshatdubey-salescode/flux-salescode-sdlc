"use client";

// "LOC Sync Status" button/modal for the performance-review developer
// drill-down — mirrors MetricMeaningModal's placement/pattern (button next
// to the heading, Dialog on click). The actual content lives in
// LocSyncStatusPanel, shared with My PRs' inline rendering of the same
// report; this file is just the Dialog chrome around it, fetching lazily
// (active={open}) so opening the drill-down page doesn't itself trigger the
// per-Jira reason diagnosis until someone actually asks for it.
import { useState } from "react";
import { RiCloseLine, RiGitPullRequestLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LocSyncStatusPanel } from "@/components/loc-sync-status-panel";

export function LocSyncStatusModal({ email, quarterKey }: { email: string; quarterKey: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <RiGitPullRequestLine className="size-4" />
          LOC Sync Status
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85vh] max-w-4xl flex-col overflow-hidden sm:max-w-4xl"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center justify-between gap-3">
            <span>LOC Sync Status</span>
            <DialogClose asChild>
              <Button variant="ghost" size="icon-sm">
                <RiCloseLine />
                <span className="sr-only">Close</span>
              </Button>
            </DialogClose>
          </DialogTitle>
        </DialogHeader>

        <div className="-mx-4 -mb-4 min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <LocSyncStatusPanel email={email} quarterKey={quarterKey} active={open} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
