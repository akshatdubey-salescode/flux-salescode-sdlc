"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Long text (the AI review's summary, a long finding) shows its first few lines with "Show more", and all of it once
 * opened. Short text renders as it is. The text itself is never cut here.
 */
export function ExpandableText({ text, className, collapsedLines = 4, threshold = 360 }: { text: string; className?: string; collapsedLines?: number; threshold?: number }) {
  const [open, setOpen] = useState(false);
  const long = text.length > threshold;
  return (
    <div>
      <p
        className={cn("whitespace-pre-wrap", className)}
        style={long && !open ? { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: collapsedLines, overflow: "hidden" } : undefined}
      >
        {text}
      </p>
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-0.5 text-[11px] font-medium text-primary underline-offset-2 hover:underline">
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
