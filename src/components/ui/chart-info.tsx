"use client"

import { RiInformationLine } from "@remixicon/react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function ChartInfo({ description }: { description: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="flex items-center justify-center rounded-full text-muted-foreground/40 hover:text-muted-foreground transition-colors focus-visible:outline-none"
            aria-label="Chart information"
          >
            <RiInformationLine className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="max-w-[280px] text-left leading-relaxed"
        >
          {description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
