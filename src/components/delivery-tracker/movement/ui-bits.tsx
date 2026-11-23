"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RiCheckLine, RiFileCopyLine, RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { TONE_CLASSES, type Tone } from "./view-model";

/** A small status / count pill. Plain text only. */
export function Chip({ tone = "neutral", children, title, className, testId }: { tone?: Tone; children: React.ReactNode; title?: string; className?: string; testId?: string }) {
  return (
    <span data-testid={testId} title={title} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", TONE_CLASSES[tone], className)}>
      {children}
    </span>
  );
}

/**
 * A button that stays visible when the user may not act and says why in a tooltip (a disabled
 * button swallows hover, so the tooltip hangs on a wrapper). `reason` is shown only when disabled.
 */
export function GuardedButton({
  reason,
  disabled,
  wrapperClassName,
  ...props
}: React.ComponentProps<typeof Button> & { reason?: string | null; wrapperClassName?: string }) {
  const off = !!disabled;
  const btn = <Button {...props} disabled={off} aria-disabled={off || undefined} />;
  if (!off || !reason) return btn;
  // The wrapper is what a screen reader lands on (a disabled button is skipped), so it says WHAT is unavailable and why.
  const label = props["aria-label"] ?? textOf(props.children);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex", wrapperClassName)} tabIndex={0} role="note" aria-label={label ? `${label}: ${reason}` : reason}>
            {btn}
          </span>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Focus the first control with one of these test ids that exists and can take focus; true when one did. */
export function focusFirstOf(testIds: readonly string[]): boolean {
  for (const id of testIds) {
    const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, "\\$&");
    const el = document.querySelector<HTMLElement>(`[data-testid="${esc}"]`);
    if (el && !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true") {
      el.focus();
      return true;
    }
  }
  return false;
}

/**
 * Focus return for a dialog opened from a control that is not a Radix trigger (they are all controlled by state): without it, closing
 * a nested dialog leaves focus on <body>, and the next Tab jumps to the page behind the panel. `remember` is called by the click
 * that opens the dialog with the test ids of the opener (see openerTestIds); `onCloseAutoFocus` goes on the dialog's content and
 * focuses the first of them that still exists (rows re-render, so it is looked up by test id at close time, not held as an element),
 * falling back to the movement page.
 */
export function useFocusReturn() {
  const ids = useRef<readonly string[]>([]);
  return {
    remember: (testIds: readonly string[]) => {
      ids.current = testIds;
    },
    onCloseAutoFocus: (e: Event) => {
      e.preventDefault();
      if (!focusFirstOf(ids.current)) focusFirstOf(["movement-page"]);
    },
  };
}

/** The plain text of a React node (strings and numbers only), for an accessible name. */
export function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("").replace(/\s+/g, " ").trim();
  return "";
}

/** Writes text (that may still be on its way) to the clipboard, through a ClipboardItem when the browser has one so the write keeps the user's click. */
export async function writeClipboard(pending: Promise<string>): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": pending.then((t) => new Blob([t], { type: "text/plain" })) })]);
  } else {
    await navigator.clipboard.writeText(await pending);
  }
}

/** Thrown by an async `getText` that already told the user why there is nothing to copy (so the button adds no second message). */
export class CopyHandled extends Error {}

/**
 * Copies `getText()` (built on click, so a big checklist is only rendered to text when asked). `getText` may be async (the checklist is fetched
 * on demand): the button then says "Copying…" and is off only while that is in flight. The clipboard is written through a ClipboardItem that
 * takes the pending text, so the write still counts as the user's click even when the fetch takes a while (Safari, a slow network).
 */
export function CopyButton({ getText, label = "Copy", testId, className, disabled }: { getText: () => string | Promise<string>; label?: string; testId?: string; className?: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  async function copy() {
    if (busy) return;
    setBusy(true);
    try {
      await writeClipboard(Promise.resolve(getText()));
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      if (!(e instanceof CopyHandled)) toast.error("Could not copy; select the text and copy it by hand");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button type="button" variant="outline" size="sm" className={cn("h-7 text-[11px]", className)} onClick={copy} disabled={disabled || busy} aria-busy={busy || undefined} data-testid={testId}>
      {copied ? (
        <>
          <RiCheckLine className="size-3.5" /> Copied!
        </>
      ) : busy ? (
        <>
          <RiLoader4Line className="size-3.5 animate-spin" /> Copying…
        </>
      ) : (
        <>
          <RiFileCopyLine className="size-3.5" /> {label}
        </>
      )}
    </Button>
  );
}

/** A ticking clock for "5 min ago" labels and the elapsed seconds of a running refresh; ticks only while `active`. */
export function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs]);
  return now;
}
