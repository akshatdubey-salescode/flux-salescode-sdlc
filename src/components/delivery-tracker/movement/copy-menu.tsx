"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { RiArrowDownSLine, RiCheckLine, RiFileCopyLine, RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { jirasCopyText, type CopyJiraItem } from "./jira-notes";
import { CopyHandled, writeClipboard } from "./ui-bits";

/** The three entries of the Copy menu, with whether each can be used (a list with nothing to copy says why instead of copying an empty text). */
export function copyMenuModel(items: ReadonlyArray<Pick<CopyJiraItem, "included">>): Array<{ id: "checklist" | "summary" | "selected" | "all"; label: string; disabled: boolean; reason: string | null }> {
  const selected = items.filter((i) => i.included).length;
  return [
    { id: "checklist", label: "Copy checklist", disabled: false, reason: null },
    { id: "summary", label: "Copy summary", disabled: false, reason: null },
    items.length === 0
      ? { id: "selected", label: "No Jiras selected", disabled: true, reason: "This movement has no Jiras" }
      : selected === 0
        ? { id: "selected", label: "No Jiras selected", disabled: true, reason: "Tick at least one Jira to copy the selected ones" }
        : { id: "selected", label: `Copy Jiras (selected, ${selected})`, disabled: false, reason: null },
    items.length === 0 ? { id: "all", label: "No Jiras in this movement", disabled: true, reason: "This movement has no Jiras" } : { id: "all", label: `Copy Jiras (all, ${items.length})`, disabled: false, reason: null },
  ];
}

/**
 * "Copy" with a small menu: the whole checklist (fetched on demand by `onCopyChecklist`), the summary of all Jiras (`onCopySummary`), or just the Jiras: the selected ones, or all of them
 * with their status marker. The two Jira variants are built from the view's items only (no checklist, no request). A menu button
 * (aria-haspopup, aria-expanded); Arrow keys move between the items, Escape or Tab closes it and Escape returns focus to the button.
 */
export function CopyMenu({
  environment,
  deliveryName,
  items,
  jiraBaseUrl,
  onCopyChecklist,
  onCopySummary,
  triggerTestId,
  initialOpen = false,
}: {
  environment: string;
  deliveryName: string;
  items: ReadonlyArray<CopyJiraItem>;
  jiraBaseUrl: string | null;
  /** The checklist as text (the page loads it on demand and explains a refusal itself, then throws CopyHandled). */
  onCopyChecklist: () => Promise<string>;
  /** The summary of all Jiras as text (loaded on demand like the checklist; the page explains a refusal itself). Absent: no such entry. */
  onCopySummary?: () => Promise<string>;
  triggerTestId: string;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuId = useId();
  const model = useMemo(() => copyMenuModel(items).filter((m) => m.id !== "summary" || !!onCopySummary), [items, onCopySummary]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  // Opening puts focus on the first usable item; a click outside closes.
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function run(id: "checklist" | "summary" | "selected" | "all") {
    setOpen(false);
    triggerRef.current?.focus();
    setBusy(true);
    try {
      const pending = id === "checklist" ? onCopyChecklist() : id === "summary" ? onCopySummary!() : Promise.resolve(jirasCopyText({ environment, deliveryName, items, jiraBaseUrl, variant: id }));
      await writeClipboard(pending);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      if (!(e instanceof CopyHandled)) toast.error("Could not copy; select the text and copy it by hand");
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "Tab") setOpen(false);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const els = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
      const at = els.indexOf(document.activeElement as HTMLElement);
      els[(at + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
    }
  }

  return (
    <div ref={rootRef} className="relative inline-block" onKeyDown={onKeyDown}>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-[11px]"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={busy || undefined}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        data-testid={triggerTestId}
      >
        {copied ? <RiCheckLine className="size-3.5" /> : busy ? <RiLoader4Line className="size-3.5 animate-spin" /> : <RiFileCopyLine className="size-3.5" />}
        {copied ? "Copied!" : busy ? "Copying…" : "Copy"}
        <RiArrowDownSLine className="size-3.5" />
      </Button>
      {open && (
        <div id={menuId} role="menu" aria-label="Copy" data-testid="movement-copy-menu" className="absolute right-0 z-30 mt-1 min-w-56 rounded-md border border-border bg-popover p-1 text-xs shadow-md">
          {model.map((m) => (
            <button
              key={m.id}
              type="button"
              role="menuitem"
              aria-disabled={m.disabled || undefined}
              title={m.reason ?? undefined}
              tabIndex={m.disabled ? -1 : 0}
              onClick={() => !m.disabled && void run(m.id)}
              data-testid={m.id === "checklist" ? "movement-copy-checklist" : m.id === "summary" ? "movement-copy-summary" : m.id === "selected" ? "movement-copy-jiras-selected" : "movement-copy-jiras-all"}
              className={cn("flex w-full items-center rounded px-2 py-1.5 text-left focus-visible:bg-muted focus-visible:outline-none", m.disabled ? "cursor-not-allowed text-muted-foreground" : "hover:bg-muted")}
            >
              <span className="flex-1">{m.label}</span>
              {m.disabled && m.reason && <span className="ml-2 text-[10px]">{m.reason}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
