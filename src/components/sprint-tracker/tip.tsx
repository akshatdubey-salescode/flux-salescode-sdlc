"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Instant tooltip for icon-only / ambiguous controls — the native `title`
 * attribute is too slow and easy to miss to carry the UI on its own.
 * Composes with other Radix triggers (Dialog/Select) via asChild.
 */
export function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-60 text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
