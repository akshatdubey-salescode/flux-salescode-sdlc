"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  RiAddLine,
  RiPencilLine,
  RiDeleteBinLine,
  RiCloseLine,
  RiExternalLinkLine,
  RiSearchLine,
  RiChat3Line,
  RiFileCopyLine,
  RiCheckLine,
  RiArrowRightLine,
  RiCheckboxCircleLine,
  RiHistoryLine,
  RiLayoutColumnLine,
  RiDownload2Line,
  RiMore2Line,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { localDateStr, getQuarterChips } from "@/lib/date-utils";
import { statusCategoryStyles, priorityStyles } from "@/components/project-tracking/helpers";
import {
  DELIVERY_STATUSES,
  deliveryStatusStyles,
  deliveryStatusLabel,
  isDeliveredLate,
  type DeliveryStatusValue,
} from "@/lib/deliveries/status";
import { DelayLogButton } from "@/components/delay-tracker/delay-log-button";
import { DeliveryBadge } from "./delivery-badge";
import { refreshDeliverySummary, subscribeToDeliveryListChanges } from "./delivery-summary-cache";
import { CreateDeliveryForm } from "./create-delivery-form";
import { IssueMultiPicker, type IssueResult } from "./issue-multi-picker";
import { ItemDetailModal } from "./item-detail-modal";
import { useColumnVisibility, TOGGLEABLE_COLUMNS, type ColumnKey } from "./use-column-visibility";
import type { DeliveryWithItems, DeliveryItemRow, DeliveryRollup, DeliveryOption } from "@/lib/deliveries/entries";

type DeliveriesResponse = { deliveries: DeliveryWithItems[] };

function deliveryMatchesSearch(delivery: DeliveryWithItems, query: string): boolean {
  const q = query.toLowerCase();
  if (delivery.name.toLowerCase().includes(q)) return true;
  if (delivery.responsibleNames.some((n) => n.toLowerCase().includes(q))) return true;
  if (delivery.responsibleEmails.some((e) => e.toLowerCase().includes(q))) return true;
  if (delivery.items.some((i) => i.jiraKey.toLowerCase().includes(q))) return true;
  return false;
}

/** Plain-text summary of ONE delivery's (currently-filtered) items — for pasting into Slack/email. Mirrors team-timeline-client's buildAlertMessage shape. */
function buildDeliveryAlertMessage(delivery: DeliveryWithItems, items: DeliveryItemRow[]): string {
  const dateLabel = new Date().toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
  const lines: string[] = [
    `📦 ${delivery.name} — ${delivery.deliveryDate} (${delivery.rollup.delivered}/${delivery.rollup.total} delivered) — as of ${dateLabel}`,
  ];
  for (const item of items) {
    lines.push(`  • ${item.jiraKey} — ${item.summary} [${deliveryStatusLabel(item.status)}]`);
  }
  return lines.join("\n");
}

export function DeliveryTrackerTab({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [deliveries, setDeliveries] = useState<DeliveryWithItems[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Set<DeliveryStatusValue>>(() => new Set());
  const [showCompleted, setShowCompleted] = useState(false);
  const { visibleColumns, toggleColumn, resetColumns } = useColumnVisibility();
  const [exporting, setExporting] = useState(false);

  const load = useCallback(() => {
    // no-store: same browser-fetch-cache staleness this feature hit
    // elsewhere — this list is re-fetched right after add/remove/status
    // mutations, so a cached response for this exact URL would silently
    // undo the whole point of reloading.
    fetch(`/api/projects/${projectId}/deliveries`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: DeliveriesResponse) => setDeliveries(d.deliveries))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  // Radix Tabs keeps every project tab mounted at once, so Project
  // Tracking's "+" add-to-delivery menu (or its "New delivery" dialog) can
  // mutate this exact data while this tab sits hidden but mounted — without
  // this, switching back to Delivery Tracking showed whatever was fetched
  // at initial mount, not the item that was just attached elsewhere.
  useEffect(() => subscribeToDeliveryListChanges(load), [load]);

  // Every OTHER active (non-completed) delivery an issue already belongs to
  // — computed from data already in memory so the "migrate to" picker can
  // exclude a guaranteed-conflict target without an extra fetch per row.
  const deliveriesByIssue = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const d of deliveries ?? []) {
      for (const item of d.items) {
        const set = map.get(item.issueId) ?? new Set<string>();
        set.add(d.id);
        map.set(item.issueId, set);
      }
    }
    return map;
  }, [deliveries]);

  const migrationTargets: DeliveryOption[] = useMemo(
    () =>
      (deliveries ?? [])
        .filter((d) => !d.completedAt)
        .map((d) => ({ id: d.id, name: d.name, deliveryDate: d.deliveryDate })),
    [deliveries]
  );

  const completedCount = useMemo(() => (deliveries ?? []).filter((d) => d.completedAt).length, [deliveries]);

  const filteredDeliveries = useMemo(() => {
    if (!deliveries) return null;
    const query = search.trim();
    return deliveries
      .filter((d) => {
        if (!showCompleted && d.completedAt) return false;
        if (dateFrom && d.deliveryDate < dateFrom) return false;
        if (dateTo && d.deliveryDate > dateTo) return false;
        if (query && !deliveryMatchesSearch(d, query)) return false;
        return true;
      })
      .map((d) => ({
        ...d,
        visibleItems: statusFilter.size === 0 ? d.items : d.items.filter((i) => statusFilter.has(i.status)),
      }))
      .filter((d) => statusFilter.size === 0 || d.visibleItems.length > 0);
  }, [deliveries, search, dateFrom, dateTo, statusFilter, showCompleted]);

  const hasActiveFilter = !!search.trim() || !!dateFrom || !!dateTo || statusFilter.size > 0;

  // Sends exactly what's currently on screen (post search/date/status/
  // show-completed filters) — there's no server-side query to re-run with
  // the same filters the way Project Tracking's export does, since all of
  // this filtering already happens client-side above. Column visibility
  // never factors in; the export's columns are fixed (see the export
  // route), regardless of what's toggled hidden on screen.
  async function handleExport() {
    if (!filteredDeliveries) return;
    setExporting(true);
    try {
      const res = await fetch("/api/deliveries/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveries: filteredDeliveries.map((d) => ({
            name: d.name,
            deliveryDate: d.deliveryDate,
            items: d.visibleItems,
          })),
        }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();

      const today = new Date().toISOString().split("T")[0];
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `deliveries-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // silently ignore — user can retry, matching My Tasks' export button
    } finally {
      setExporting(false);
    }
  }

  function toggleStatusFilter(value: DeliveryStatusValue) {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Jira tasks and bugs committed to a delivery date, grouped by delivery.
        </p>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <RiLayoutColumnLine className="size-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {TOGGLEABLE_COLUMNS.map((col) => {
                const checked = visibleColumns.has(col.key);
                return (
                  <DropdownMenuCheckboxItem
                    key={col.key}
                    checked={checked}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={() => toggleColumn(col.key)}
                    disabled={checked && visibleColumns.size <= 1}
                  >
                    {col.label}
                  </DropdownMenuCheckboxItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={false}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={resetColumns}
              >
                Show all
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting || !filteredDeliveries || filteredDeliveries.length === 0}
          >
            <RiDownload2Line className="size-3.5" />
            {exporting ? "Exporting…" : "Export Excel"}
          </Button>
          {canManage && (
            <CreateDeliveryForm
              projectId={projectId}
              trigger={
                <Button size="sm">
                  <RiAddLine className="size-3.5" />
                  New delivery
                </Button>
              }
              onSaved={load}
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs flex-1 sm:min-w-[220px]">
          <RiSearchLine className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search delivery, user, or Jira ID…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="flex items-center gap-0.5">
          {getQuarterChips().map((q) => {
            const active = dateFrom === q.start && dateTo === q.end;
            return (
              <button
                key={q.label}
                type="button"
                onClick={() => {
                  setDateFrom(active ? null : q.start);
                  setDateTo(active ? null : q.end);
                }}
                className={cn(
                  "h-7 rounded-md px-2.5 text-[11px] font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "border border-input bg-transparent text-foreground hover:bg-muted/50"
                )}
              >
                {q.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <Label className="text-muted-foreground">From</Label>
          <Input
            type="date"
            value={dateFrom ?? ""}
            onChange={(e) => setDateFrom(e.target.value || null)}
            className="h-7 w-36 text-xs"
          />
          <Label className="text-muted-foreground">To</Label>
          <Input
            type="date"
            value={dateTo ?? ""}
            onChange={(e) => setDateTo(e.target.value || null)}
            className="h-7 w-36 text-xs"
          />
        </div>
        {hasActiveFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setDateFrom(null);
              setDateTo(null);
              setStatusFilter(new Set());
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Item status</span>
        <div className="flex items-center gap-1">
          {DELIVERY_STATUSES.map((s) => {
            const active = statusFilter.has(s.value);
            const styles = deliveryStatusStyles(s.value);
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => toggleStatusFilter(s.value)}
                className={cn(
                  "h-6 rounded-full px-2.5 text-[10px] font-semibold transition-colors",
                  active ? styles.badge : "bg-muted/40 text-muted-foreground hover:bg-muted"
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        {completedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            className="ml-auto flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <RiHistoryLine className="size-3.5" />
            {showCompleted ? "Hide completed" : `Show completed (${completedCount})`}
          </button>
        )}
      </div>

      {deliveries === null && !error && (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-lg" />
          ))}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {deliveries && deliveries.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-xs text-muted-foreground">No deliveries yet for this project.</p>
        </div>
      )}
      {deliveries && deliveries.length > 0 && filteredDeliveries?.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-xs text-muted-foreground">
            {!showCompleted && completedCount > 0 && deliveries.every((d) => d.completedAt)
              ? `All ${completedCount} deliveries are completed.`
              : "No deliveries match these filters."}
          </p>
        </div>
      )}
      {filteredDeliveries?.map((delivery) => (
        <DeliveryCard
          key={delivery.id}
          delivery={delivery}
          visibleItems={delivery.visibleItems}
          canManage={canManage}
          visibleColumns={visibleColumns}
          onChanged={load}
          migrationTargets={migrationTargets.filter((o) => o.id !== delivery.id)}
          deliveriesByIssue={deliveriesByIssue}
        />
      ))}
    </div>
  );
}

function daysBetween(dateStr: string, today: string): number {
  const d = new Date(dateStr + "T00:00:00");
  const t = new Date(today + "T00:00:00");
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}

/** Planned Start/Due date for the items table's own two columns — same
 * source (extractStartDate/extractDueDate) as My Tasks' Plan column, just
 * displayed as its own compact date rather than a Planned/Unplanned badge. */
function formatPlanDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Actual Start/End are full datetimes (not just a calendar date like
 * Start/End Date), so this parses the ISO string directly rather than
 * pinning it to local midnight the way formatPlanDate does. */
function formatActualDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function RollupCounts({ rollup }: { rollup: DeliveryRollup }) {
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
      <span className="font-semibold text-foreground">
        {rollup.delivered}/{rollup.total} delivered
      </span>
      {rollup.partiallyDelivered > 0 && <span className="text-amber-600 dark:text-amber-400">{rollup.partiallyDelivered} partial</span>}
      {rollup.notDelivered > 0 && <span className="text-red-600 dark:text-red-400">{rollup.notDelivered} not delivered</span>}
      {rollup.pending > 0 && <span>{rollup.pending} pending</span>}
    </div>
  );
}

function DeliveryCard({
  delivery,
  visibleItems,
  canManage,
  visibleColumns,
  onChanged,
  migrationTargets,
  deliveriesByIssue,
}: {
  delivery: DeliveryWithItems;
  /** Items after the item-status filter (a subset of delivery.items) — what the table actually renders. */
  visibleItems: DeliveryItemRow[];
  canManage: boolean;
  visibleColumns: Set<ColumnKey>;
  onChanged: () => void;
  /** Other active deliveries an item in this card could migrate to. */
  migrationTargets: DeliveryOption[];
  /** issueId → set of delivery ids it's already in — used to hide guaranteed-conflict migration targets. */
  deliveriesByIssue: Map<string, Set<string>>;
}) {
  const [addingIssues, setAddingIssues] = useState<IssueResult[]>([]);
  const [adding, setAdding] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [alertCopied, setAlertCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Lets the picker gray out issues this delivery already contains.
  const existingIssueIds = useMemo(() => new Set(delivery.items.map((i) => i.issueId)), [delivery.items]);

  const today = localDateStr(new Date());
  const daysToGo = daysBetween(delivery.deliveryDate, today);
  const overdue = daysToGo < 0;
  const isComplete = !!delivery.completedAt;
  const canComplete = delivery.rollup.total > 0 && delivery.rollup.delivered === delivery.rollup.total;

  function handleCopySummary() {
    navigator.clipboard.writeText(buildDeliveryAlertMessage(delivery, visibleItems));
    setAlertCopied(true);
    setTimeout(() => setAlertCopied(false), 2000);
  }

  /** Per-sprint export — same endpoint the top-level "Export Excel" button
   * uses, just a single-delivery body instead of every filtered delivery. */
  async function handleExportSprint() {
    setExporting(true);
    try {
      const res = await fetch("/api/deliveries/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveries: [{ name: delivery.name, deliveryDate: delivery.deliveryDate, items: visibleItems }],
        }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();

      const safeName = delivery.name.replace(/[^\w-]+/g, "_");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}-${delivery.deliveryDate}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // silently ignore — user can retry, matching the other export buttons
    } finally {
      setExporting(false);
    }
  }

  async function handleAddIssues() {
    if (addingIssues.length === 0) return;
    setAdding(true);
    try {
      await fetch(`/api/deliveries/${delivery.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueIds: addingIssues.map((i) => i.id) }),
      });
      // Every badge/column showing these issues elsewhere (Project Tracking,
      // My Tasks, dashboards…) reads from the shared summary cache, which
      // this add didn't touch — refresh each one so they update immediately
      // instead of only after a reload.
      await Promise.all(addingIssues.map((i) => refreshDeliverySummary(i.id)));
      setAddingIssues([]);
      onChanged();
    } finally {
      setAdding(false);
    }
  }

  async function handleRemoveItem(itemId: string) {
    const issueId = delivery.items.find((i) => i.id === itemId)?.issueId;
    await fetch(`/api/deliveries/${delivery.id}/items/${itemId}`, { method: "DELETE" });
    if (issueId) await refreshDeliverySummary(issueId);
    onChanged();
  }

  async function handleDeleteDelivery() {
    await fetch(`/api/deliveries/${delivery.id}`, { method: "DELETE" });
    setConfirmDeleteOpen(false);
    onChanged();
  }

  async function handleToggleComplete(next: boolean) {
    setCompleting(true);
    try {
      const res = await fetch(`/api/deliveries/${delivery.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update delivery");
    } finally {
      setCompleting(false);
    }
  }

  async function handleMigrate(itemId: string, targetDeliveryId: string): Promise<boolean> {
    const issueId = delivery.items.find((i) => i.id === itemId)?.issueId;
    const res = await fetch(`/api/deliveries/${delivery.id}/items/${itemId}/migrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetDeliveryId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to migrate item");
      return false;
    }
    if (issueId) await refreshDeliverySummary(issueId);
    onChanged();
    return true;
  }

  return (
    <div className={cn("rounded-lg border border-border overflow-hidden", isComplete && "opacity-80")}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 p-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{delivery.name}</p>
            <Badge variant="outline" className="text-[10px] tabular-nums">
              {delivery.deliveryDate}
            </Badge>
            {isComplete ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                <RiCheckboxCircleLine className="size-3" />
                Completed
              </span>
            ) : (
              <span className={cn("text-[11px] font-medium", overdue ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                {overdue ? `Overdue by ${Math.abs(daysToGo)}d` : daysToGo === 0 ? "Due today" : `${daysToGo}d to go`}
              </span>
            )}
          </div>
          {delivery.responsibleNames.length > 0 && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Responsible: {delivery.responsibleNames.join(", ")}
            </p>
          )}
          {isComplete && delivery.completedByName && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">Marked complete by {delivery.completedByName}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <RollupCounts rollup={delivery.rollup} />
          {visibleItems.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={handleExportSprint}
              disabled={exporting}
            >
              <RiDownload2Line className="size-3.5" />
              {exporting ? "Exporting…" : "Export"}
            </Button>
          )}
          {visibleItems.length > 0 && (
            <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={handleCopySummary}>
              {alertCopied ? (
                <>
                  <RiCheckLine className="size-3.5" /> Copied!
                </>
              ) : (
                <>
                  <RiFileCopyLine className="size-3.5" /> Copy
                </>
              )}
            </Button>
          )}
          {canManage && (
            <div className="flex items-center gap-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        variant={isComplete ? "ghost" : "outline"}
                        size="sm"
                        className="h-7 text-[11px]"
                        disabled={completing || (!isComplete && !canComplete)}
                        onClick={() => handleToggleComplete(!isComplete)}
                      >
                        <RiCheckboxCircleLine className="size-3.5" />
                        {isComplete ? "Reopen" : "Mark complete"}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {!isComplete && !canComplete && (
                    <TooltipContent>Every item must be Delivered first.</TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
              <CreateDeliveryForm
                projectId={delivery.projectId}
                delivery={delivery}
                trigger={
                  <Button variant="ghost" size="icon-sm" title="Edit delivery">
                    <RiPencilLine className="size-3.5" />
                  </Button>
                }
                onSaved={onChanged}
              />
              <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
                <Button variant="ghost" size="icon-sm" title="Delete delivery" onClick={() => setConfirmDeleteOpen(true)}>
                  <RiDeleteBinLine className="size-3.5" />
                </Button>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this delivery?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Its items and their delivery status stay in the system for audit purposes, but this delivery stops
                      counting anywhere (badges, rollups, the reminder banner).
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={handleDeleteDelivery}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
      </div>

      {canManage && !isComplete && (
        <div className="border-b border-border p-2.5">
          <IssueMultiPicker
            projectId={delivery.projectId}
            value={addingIssues}
            onChange={setAddingIssues}
            existingIssueIds={existingIssueIds}
            onSubmit={handleAddIssues}
            submitting={adding}
          />
        </div>
      )}

      {visibleItems.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-xs text-muted-foreground">
            {delivery.items.length === 0
              ? "No issues committed to this delivery yet."
              : "No items match the current status filter."}
          </p>
        </div>
      ) : (
        <DeliveryItemsTable
          deliveryId={delivery.id}
          deliveryDate={delivery.deliveryDate}
          items={visibleItems}
          canManage={canManage}
          visibleColumns={visibleColumns}
          onRemoveItem={handleRemoveItem}
          onChanged={onChanged}
          onMigrate={handleMigrate}
          migrationTargetsByIssue={(issueId) =>
            migrationTargets.filter((o) => !deliveriesByIssue.get(issueId)?.has(o.id))
          }
        />
      )}
    </div>
  );
}

function DeliveryItemsTable({
  deliveryId,
  deliveryDate,
  items,
  canManage,
  visibleColumns,
  onRemoveItem,
  onChanged,
  onMigrate,
  migrationTargetsByIssue,
}: {
  deliveryId: string;
  deliveryDate: string;
  items: DeliveryItemRow[];
  canManage: boolean;
  visibleColumns: Set<ColumnKey>;
  onRemoveItem: (itemId: string) => void;
  onChanged: () => void;
  onMigrate: (itemId: string, targetDeliveryId: string) => Promise<boolean>;
  migrationTargetsByIssue: (issueId: string) => DeliveryOption[];
}) {
  const [detailItem, setDetailItem] = useState<DeliveryItemRow | null>(null);
  const isVisible = (key: ColumnKey) => visibleColumns.has(key);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/20">
            {isVisible("key") && <th className="px-3 py-2 text-left font-medium text-muted-foreground">Key</th>}
            {isVisible("summary") && <th className="px-3 py-2 text-left font-medium text-muted-foreground">Summary</th>}
            {isVisible("jiraStatus") && <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>}
            {isVisible("priority") && <th className="px-3 py-2 text-left font-medium text-muted-foreground">Priority</th>}
            {isVisible("assignee") && <th className="px-3 py-2 text-left font-medium text-muted-foreground">Assignee</th>}
            {isVisible("delivery") && <th className="px-3 py-2 text-left font-medium text-muted-foreground">Delivery</th>}
            {isVisible("startDate") && <th className="px-3 py-2 text-left font-medium text-muted-foreground">Start Date</th>}
            {isVisible("dueDate") && <th className="px-3 py-2 text-left font-medium text-muted-foreground">End Date</th>}
            {isVisible("actualStart") && <th className="px-3 py-2 text-left font-medium text-muted-foreground">Actual Start</th>}
            {isVisible("actualEnd") && <th className="px-3 py-2 text-left font-medium text-muted-foreground">Actual End</th>}
            {isVisible("comments") && <th className="px-2 py-2" />}
            <th className="px-2 py-2" />
            {canManage && <th className="w-16 px-2 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {items.map((item) => {
            const sStyles = statusCategoryStyles(item.jiraStatus);
            const pStyles = priorityStyles(item.priority);
            return (
              <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                {isVisible("key") && (
                  <td className="px-3 py-2 whitespace-nowrap">
                    <a
                      href={`${item.jiraBaseUrl.replace(/\/$/, "")}/browse/${item.jiraKey}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono font-medium text-foreground hover:text-primary transition-colors"
                    >
                      {item.jiraKey}
                      <RiExternalLinkLine className="size-3 opacity-40" />
                    </a>
                  </td>
                )}
                {isVisible("summary") && (
                  <td className="px-3 py-2 max-w-[240px]">
                    <span className="block truncate" title={item.summary}>{item.summary}</span>
                  </td>
                )}
                {isVisible("jiraStatus") && (
                  <td className="px-3 py-2">
                    <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold", sStyles.badge)}>
                      {item.jiraStatus}
                    </span>
                  </td>
                )}
                {isVisible("priority") && (
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn("size-1.5 rounded-full", pStyles.dot)} />
                      <span className={cn("font-medium", pStyles.text)}>{item.priority ?? "—"}</span>
                    </span>
                  </td>
                )}
                {isVisible("assignee") && (
                  <td className="px-3 py-2 text-muted-foreground">{item.assigneeName ?? "—"}</td>
                )}
                {isVisible("delivery") && (
                  <td className="px-3 py-2">
                    <DeliveryStatusCell deliveryId={deliveryId} deliveryDate={deliveryDate} item={item} onUpdated={onChanged} />
                  </td>
                )}
                {isVisible("startDate") && (
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatPlanDate(item.startDate)}</td>
                )}
                {isVisible("dueDate") && (
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatPlanDate(item.dueDate)}</td>
                )}
                {isVisible("actualStart") && (
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatActualDate(item.actualStart)}</td>
                )}
                {isVisible("actualEnd") && (
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatActualDate(item.actualEnd)}</td>
                )}
                {isVisible("comments") && (
                  <td className="px-2 py-2">
                    <CommentCell deliveryId={deliveryId} item={item} onUpdated={onChanged} />
                  </td>
                )}
                <td className="px-2 py-2">
                  <div className="flex items-center gap-0.5">
                    <DelayLogButton issueId={item.issueId} />
                    <DeliveryBadge issueId={item.issueId} canManage={canManage} onChanged={onChanged} />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="View details"
                      onClick={() => setDetailItem(item)}
                    >
                      <RiMore2Line className="size-3.5" />
                      <span className="sr-only">View details</span>
                    </Button>
                  </div>
                </td>
                {canManage && (
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-0.5">
                      <MigrateButton
                        itemId={item.id}
                        targets={migrationTargetsByIssue(item.issueId)}
                        onMigrate={onMigrate}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Remove from delivery"
                        onClick={() => onRemoveItem(item.id)}
                      >
                        <RiCloseLine className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {detailItem && (
        <ItemDetailModal
          item={detailItem}
          open={detailItem !== null}
          onOpenChange={(open) => { if (!open) setDetailItem(null); }}
        />
      )}
    </div>
  );
}

/** Re-home one item to a different active delivery — a pure move (see the migrate route): removed from here, added there, status/comment carried over untouched. */
function MigrateButton({
  itemId,
  targets,
  onMigrate,
}: {
  itemId: string;
  targets: DeliveryOption[];
  onMigrate: (itemId: string, targetDeliveryId: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);

  if (targets.length === 0) return null;

  async function handleMigrate() {
    if (!target) return;
    setSaving(true);
    try {
      const ok = await onMigrate(itemId, target);
      if (ok) {
        setOpen(false);
        setTarget("");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" title="Migrate to another delivery">
          <RiArrowRightLine className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2" align="start">
        <p className="text-xs font-medium text-foreground">Migrate to delivery</p>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue placeholder="Choose delivery…" />
          </SelectTrigger>
          <SelectContent>
            {targets.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name} · {d.deliveryDate}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" className="w-full" onClick={handleMigrate} disabled={!target || saving}>
          {saving ? "Migrating…" : "Migrate"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Inline status + comment editor for one item's delivery outcome — this is
 * the primary place to mark Delivered/Partially/Not Delivered (any
 * authenticated user, not just admins), so it has to work without opening a
 * dialog. Status auto-saves on change; the comment is edited in a small
 * popover since it's optional and multi-line. Both PATCH the same endpoint
 * the DeliveryItemPanel uses, and both refresh the shared summary cache so
 * badges everywhere else this issue appears (My Tasks, dashboards, etc.)
 * recolor immediately too — the "vice versa" of attaching an issue. The
 * server also mirrors this status to every OTHER delivery containing the
 * same issue; onUpdated triggers a full reload of every delivery card so
 * those mirrored siblings show up-to-date too.
 */
/** Status only — the comment half of this same PATCH endpoint moved to its
 * own CommentCell, in the Comments column, so the two aren't both crammed
 * (and duplicated-looking) into the Delivery column. */
function DeliveryStatusCell({
  deliveryId,
  deliveryDate,
  item,
  onUpdated,
}: {
  deliveryId: string;
  deliveryDate: string;
  item: DeliveryItemRow;
  onUpdated: () => void;
}) {
  const [status, setStatus] = useState<DeliveryStatusValue>(item.status);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus(item.status);
  }, [item.status]);

  async function handleStatusChange(value: string) {
    const next = value as DeliveryStatusValue;
    setStatus(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/deliveries/${deliveryId}/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Comment is untouched here — CommentCell owns it exclusively now.
        body: JSON.stringify({ status: next, statusComment: item.statusComment }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await refreshDeliverySummary(item.issueId);
      onUpdated();
    } catch (e) {
      setStatus(item.status);
      toast.error(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setSaving(false);
    }
  }

  // Same rule as the item panel's MembershipRow: late-styling reflects the
  // SAVED outcome, not an in-progress draft selection.
  const isLate = status === item.status && isDeliveredLate(item.status, deliveryDate, item.statusSetAt);
  const styles = deliveryStatusStyles(status, isLate);

  return (
    <Select value={status} onValueChange={handleStatusChange} disabled={saving}>
      <SelectTrigger size="sm" className={cn("h-6 w-[132px] rounded-full text-[10px] font-semibold", styles.badge)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DELIVERY_STATUSES.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Read-only comment text + its own edit popover — the other half of the
 * same PATCH endpoint DeliveryStatusCell uses, now living only in the
 * Comments column (hidden by default, opt-in via the Columns menu). */
function CommentCell({
  deliveryId,
  item,
  onUpdated,
}: {
  deliveryId: string;
  item: DeliveryItemRow;
  onUpdated: () => void;
}) {
  const [comment, setComment] = useState(item.statusComment ?? "");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setComment(item.statusComment ?? "");
  }, [item.statusComment]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/deliveries/${deliveryId}/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Status is untouched here — DeliveryStatusCell owns it exclusively.
        body: JSON.stringify({ status: item.status, statusComment: comment.trim() || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await refreshDeliverySummary(item.issueId);
      onUpdated();
      setOpen(false);
    } catch (e) {
      setComment(item.statusComment ?? "");
      toast.error(e instanceof Error ? e.message : "Failed to update comment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      {/* Icon only, deliberately — no comment-text preview in this cell. A
          filled icon just signals a comment exists; open the popover to
          actually read/edit it. */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            title={item.statusComment ? "Edit comment" : "Add comment"}
          >
            <RiChat3Line className={cn("size-3.5", item.statusComment && "text-foreground")} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-2" align="start">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional comment…"
            className="min-h-16 text-xs"
          />
          <Button size="sm" className="w-full" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save comment"}
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
