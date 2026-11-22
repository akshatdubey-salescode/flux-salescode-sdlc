"use client";

import { RiRefreshLine } from "@remixicon/react";
import { Chip, GuardedButton, useNow } from "./ui-bits";
import { CopyMenu } from "./copy-menu";
import { ExportMenu } from "./movement-checklist";
import type { MovementView } from "./api-types";
import type { RefreshUi } from "./use-movement";
import { actionState, conflictKindCounts, envLabel, formatAge, formatIst, serverNowAt, statusLabel, statusTone } from "./view-model";

/**
 * Delivery, environment, status, data age with Refresh, and the checklist's one-line summary.
 * Ages are measured on the server's clock: `view.serverNow` plus the time since the view arrived (`receivedAt`).
 */
export function MovementHeader({
  view,
  onCopyAll,
  onCopySummary,
  jiraBaseUrl,
  refreshUi,
  refreshing,
  receivedAt,
  onRefresh,
  exportBase,
}: {
  view: MovementView;
  /** The checklist as text for the clipboard; the page loads the checklist on demand if no tab has (and explains a refusal itself). */
  onCopyAll: () => Promise<string>;
  /** The summary of all Jiras as text (the page loads it on demand). */
  onCopySummary?: () => Promise<string>;
  /** For the Jira links of "Copy Jiras" (null: no links). */
  jiraBaseUrl: string | null;
  refreshUi: RefreshUi;
  /** A refresh the server reports and this page still waits for (see useMovement.serverRefreshing). */
  refreshing: boolean;
  receivedAt: number | null;
  onRefresh: () => void;
  exportBase: string;
}) {
  const local = useNow(true, 30_000);
  const now = serverNowAt(view.serverNow, receivedAt, local);
  const { movement, delivery } = view;
  const refresh = actionState("refresh", view);
  // "running": this browser's call, or a refresh the server reports (another user / tab).
  const running = refreshUi.phase === "running" || refreshing;
  const stats = view.checklist.stats;

  return (
    <div className="sticky top-0 z-20 space-y-1.5 border-b border-border bg-background px-3 py-2.5" data-testid="movement-header">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-sm font-semibold">
          {delivery.name} <span className="font-normal text-muted-foreground">· {delivery.date}</span>
        </h1>
        <Chip tone="info" testId="movement-env">
          {envLabel(movement.environment)}
        </Chip>
        <Chip tone={statusTone(movement.status)} testId="movement-status">
          {statusLabel(movement.status)}
        </Chip>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <CopyMenu environment={movement.environment} deliveryName={delivery.name} items={view.items} jiraBaseUrl={jiraBaseUrl} onCopyChecklist={onCopyAll} onCopySummary={onCopySummary} triggerTestId="movement-copy-all-header" />
          <ExportMenu exportBase={exportBase} disabled={view.needsRefresh} />
          <GuardedButton variant="outline" size="sm" className="h-7 text-[11px]" disabled={!refresh.allowed || running} reason={refresh.reason} onClick={onRefresh} data-testid="movement-refresh">
            <RiRefreshLine className={running ? "size-3.5 animate-spin" : "size-3.5"} />
            {running ? "Reading…" : "Refresh"}
          </GuardedButton>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span data-testid="movement-refreshed-at" title={formatIst(movement.refreshedAt)}>
            Jira review comments read {formatAge(movement.refreshedAt, now)}
            {movement.refreshedAt ? ` (${formatIst(movement.refreshedAt)} IST)` : ""}
          </span>
      </div>
      <p className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="movement-summary">
        <span className="font-semibold">{view.checklist.summary}</span>
        {stats.conflicts > 0 && <Chip tone="warn">{stats.conflicts} conflict{stats.conflicts === 1 ? "" : "s"}</Chip>}
        {stats.needsAttention > 0 && <Chip tone="danger">{stats.needsAttention} need attention</Chip>}
        {stats.unknowns > 0 && <Chip tone="warn">{stats.unknowns} unknown{stats.unknowns === 1 ? "" : "s"}</Chip>}
      </p>
      {view.checklist.conflicts.length > 0 && (
        <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground" data-testid="movement-conflict-kinds">
          Review comments disagree on:
          {conflictKindCounts(view.checklist.conflicts).map((k) => (
            <Chip key={k.kind} tone="warn" title={k.kind}>
              {k.label}
              {k.count > 1 ? ` ×${k.count}` : ""}
            </Chip>
          ))}
        </p>
      )}
      {view.permissions.notes.length > 0 && (
        <div role="status" className="space-y-0.5 rounded-md border border-amber-400 bg-amber-50/70 p-1.5 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" data-testid="movement-degraded-note">
          {view.permissions.notes.map((n, i) => (
            <p key={i} className="[overflow-wrap:anywhere]">{n}</p>
          ))}
        </div>
      )}
    </div>
  );
}
