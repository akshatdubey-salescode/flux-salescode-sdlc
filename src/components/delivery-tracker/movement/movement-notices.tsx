"use client";

import { useState } from "react";
import { RiAlertLine, RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import type { ChangesResponse } from "./api-types";
import type { RefreshUi } from "./use-movement";
import { useNow } from "./ui-bits";
import { autoRefreshReason, diffSummary, formatIst, nextShown } from "./view-model";

/**
 * The refresh states in one place: a refresh running (started here, or seen on the server: `serverRunning`),
 * or a red banner with Retry for a failed one. The failure is this browser's own failed call, else the
 * server's stored `refreshError` of the last refresh (which also closes sign-off and start).
 */
export function RefreshNotice({
  ui,
  serverRunning,
  serverError,
  canRefresh,
  onRetry,
  onDismiss,
}: {
  ui: RefreshUi;
  serverRunning: boolean;
  serverError: string | null;
  canRefresh: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const now = useNow(ui.phase === "running");
  if (ui.phase === "running" || serverRunning) {
    const s = ui.phase === "running" && ui.startedAt ? Math.max(0, Math.round((now - ui.startedAt) / 1000)) : null;
    return (
      <div role="status" aria-live="polite" data-testid="movement-refresh-running" className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-2 text-xs">
        <RiLoader4Line className="mt-0.5 size-4 shrink-0 animate-spin" />
        <div>
          <p className="font-medium">{ui.phase === "running" ? "Reading Jira comments…" : "A refresh is running…"}</p>
          <p className="text-muted-foreground">
            {s !== null ? `${s}s` : "Started by someone else or in another tab; this page follows it."}
            {ui.phase === "running" && ui.auto ? `. Refreshing automatically because ${autoRefreshReason()}.` : ""} Big deliveries can take a minute or two; you can keep working.
          </p>
        </div>
      </div>
    );
  }
  const message = ui.phase === "error" ? (ui.message ?? "The refresh failed") : serverError ? `The last read of the Jira review comments failed: ${serverError}. Sign-off and start stay closed until a refresh succeeds.` : null;
  if (!message) return null;
  return (
    <div role="alert" data-testid="movement-refresh-error" className="flex flex-wrap items-center gap-2 rounded-lg border border-red-300 bg-red-50/60 p-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
      <RiAlertLine className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{message}</span>
      {canRefresh ? (
        <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={onRetry} data-testid="movement-refresh-retry">
          Retry
        </Button>
      ) : (
        <span className="text-[11px]">Ask a delivery manager to refresh.</span>
      )}
      {ui.phase === "error" && (
        <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={onDismiss} data-testid="movement-refresh-dismiss">
          Dismiss
        </Button>
      )}
    </div>
  );
}

/** The stored Jira data cannot be read back (a code change, damage): nobody can sign until a Refresh rebuilds it. */
export function NeedsRefreshBanner({ canRefresh, running, onRefresh }: { canRefresh: boolean; running: boolean; onRefresh: () => void }) {
  return (
    <div role="alert" data-testid="movement-needs-refresh" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400 bg-amber-50/70 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
      <RiAlertLine className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 font-medium">The stored data must be re-read before anyone can sign. The checklist is not shown until then.</span>
      {canRefresh ? (
        <Button size="sm" variant="outline" className="h-6 text-[11px]" disabled={running} onClick={onRefresh} data-testid="movement-needs-refresh-action">
          {running ? "Reading…" : "Refresh"}
        </Button>
      ) : (
        <span className="text-[11px]">Ask a delivery manager to refresh.</span>
      )}
    </div>
  );
}

/** "The checklist changed since you signed": what changed (the full diff against the snapshot of what they signed). */
export function ChangesBanner({ changes }: { changes: ChangesResponse }) {
  const [open, setOpen] = useState(false);
  const diff = changes.diff;
  const [shown, setShown] = useState(20);
  const lines = diff
    ? [
        ...diff.added.map((e) => ({ kind: "added", e: `${e.section}: ${e.text}` })),
        ...diff.removed.map((e) => ({ kind: "removed", e: `${e.section}: ${e.text}` })),
        ...diff.changed.map((e) => ({ kind: "changed", e: `${e.section}: ${e.from}  ->  ${e.to}` })),
      ]
    : [];
  const last = changes.events[0];
  return (
    <div role="alert" data-testid="movement-changes-banner" className="rounded-lg border border-amber-400 bg-amber-50/70 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
      <div className="flex flex-wrap items-center gap-2">
        <RiAlertLine className="size-4 shrink-0" />
        <p className="min-w-0 flex-1 font-semibold">
          The checklist changed since you signed{diff ? `: ${diffSummary(diff)}` : "."}
          {last ? ` (last change ${formatIst(last.at)})` : ""}
        </p>
        {lines.length > 0 && (
          <Button size="sm" variant="outline" className="h-6 text-[11px]" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="movement-changes-toggle">
            {open ? "Hide changes" : "Show changes"}
          </Button>
        )}
      </div>
      {changes.snapshotMissing && <p className="mt-1">What you signed is no longer stored, so the exact difference cannot be shown. Review the checklist again before you sign.</p>}
      {diff && diff.truncated > 0 && <p className="mt-1">{diff.truncated} more entries are not listed.</p>}
      {open && lines.length > 0 && (
        <div className="mt-1 space-y-1">
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {lines.slice(0, shown).map((l, i) => (
              <li key={i} className="[overflow-wrap:anywhere]">
                <span className="mr-1 rounded bg-amber-200 px-1 text-[10px] font-semibold uppercase dark:bg-amber-900">{l.kind}</span>
                {l.e}
              </li>
            ))}
          </ul>
          {shown < lines.length && (
            <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => setShown((n) => nextShown(n, lines.length, 20))}>
              Show more ({lines.length - shown} not shown)
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function AfterStartBanner() {
  return (
    <div role="alert" data-testid="movement-after-start-banner" className="flex items-center gap-2 rounded-lg border border-amber-400 bg-amber-50/70 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
      <RiAlertLine className="size-4 shrink-0" />
      The review comments changed after the deployment started. Sign-offs were not reset; check the checklist for what changed.
    </div>
  );
}
