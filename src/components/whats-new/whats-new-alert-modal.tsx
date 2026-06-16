"use client";

import Link from "next/link";
import { RiMegaphoneLine } from "@remixicon/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import type { PublicReleaseNote } from "@/lib/release-notes/queries";

/**
 * Shown automatically the first time a user encounters an ALERT-type note.
 * Closing it (or following its link) dismisses it for good — afterwards it
 * lives only in the bell. Controlled open so the parent owns the lifecycle.
 */
export function WhatsNewAlertModal({
  note,
  onDismiss,
}: {
  note: PublicReleaseNote;
  onDismiss: () => void;
}) {
  const hasLink = Boolean(note.linkHref && note.linkLabel);

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent className="gap-0 p-0 sm:max-w-md overflow-hidden">
        <div className="flex flex-col items-center px-7 pt-8 pb-6 text-center">
          <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary ring-1 ring-primary/15">
            <RiMegaphoneLine className="size-7" />
          </div>

          <DialogHeader className="items-center gap-0">
            <DialogTitle className="text-2xl font-bold leading-tight tracking-tight">
              {note.title}
            </DialogTitle>
            <DialogDescription className="sr-only">
              What&apos;s new announcement
            </DialogDescription>
          </DialogHeader>

          <div className="mt-3 max-h-[45vh] overflow-y-auto text-sm leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
            <Markdown content={note.body} />
          </div>
        </div>

        <div className="flex gap-3 border-t border-border bg-muted/30 px-7 py-4">
          <Button
            variant="outline"
            size="lg"
            className="flex-1"
            onClick={onDismiss}
          >
            Got it
          </Button>
          {hasLink && (
            <Button size="lg" className="flex-1" asChild onClick={onDismiss}>
              <Link href={note.linkHref!}>{note.linkLabel}</Link>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
