"use client";

import { useRef, useState, type ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Shows `text` in a tooltip on hover — but only when the wrapped element is
 * actually cut off (its text overflows its box). A short text that fits is left
 * alone. Uses the same tooltip as the rest of the app rather than the native
 * `title` attribute, which embedded browsers (and touch screens) don't show.
 *
 * `children` must be a single element that can take a ref/handlers and carries
 * its own truncation classes (e.g. `<span className="truncate">`).
 */
export function TruncatedTip({ text, children }: { text: string; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  const overflowing = useRef(false);

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip open={open} onOpenChange={(o) => setOpen(o && overflowing.current)}>
        <TooltipTrigger
          asChild
          onPointerEnter={(e) => {
            const el = e.currentTarget;
            overflowing.current = el.scrollWidth > el.clientWidth;
          }}
          onFocus={(e) => {
            const el = e.currentTarget;
            overflowing.current = el.scrollWidth > el.clientWidth;
          }}
        >
          {children}
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          className="max-w-md whitespace-normal break-words"
          onClick={(e) => e.stopPropagation()}
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
