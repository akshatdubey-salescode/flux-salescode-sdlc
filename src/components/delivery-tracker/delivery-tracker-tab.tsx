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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { localDateStr, getQuarterChips } from "@/lib/date-utils";
import { statusCategoryStyles, priorityStyles } from "@/components/project-tracking/helpers";
import { DELIVERY_STATUSES, deliveryStatusStyles, type DeliveryStatusValue } from "@/lib/deliveries/status";
import { DelayLogButton } from "@/components/delay-tracker/delay-log-button";
import { DeliveryBadge } from "./delivery-badge";
import { refreshDeliverySummary } from "./delivery-summary-cache";
import { CreateDeliveryForm } from "./create-delivery-form";
import { IssueMultiPicker, type IssueResult } from "./issue-multi-picker";
import type { DeliveryWithItems, DeliveryItemRow, DeliveryRollup } from "@/lib/deliveries/entries";

type DeliveriesResponse = { deliveries: DeliveryWithItems[] };

function deliveryMatchesSearch(delivery: DeliveryWithItems, query: string): boolean {
  const q = query.toLowerCase();
  if (delivery.name.toLowerCase().includes(q)) return true;
  if (delivery.responsibleNames.some((n) => n.toLowerCase().includes(q))) return true;
  if (delivery.responsibleEmails.some((e) => e.toLowerCase().includes(q))) return true;
  if (delivery.items.some((i) => i.jiraKey.toLowerCase().includes(q))) return true;
  return false;
}

export function DeliveryTrackerTab({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [deliveries, setDeliveries] = useState<DeliveryWithItems[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);

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

  const filteredDeliveries = useMemo(() => {
    if (!deliveries) return null;
    const query = search.trim();
    return deliveries.filter((d) => {
      if (dateFrom && d.deliveryDate < dateFrom) return false;
      if (dateTo && d.deliveryDate > dateTo) return false;
      if (query && !deliveryMatchesSearch(d, query)) return false;
      return true;
    });
  }, [deliveries, search, dateFrom, dateTo]);

  const hasActiveFilter = !!search.trim() || !!dateFrom || !!dateTo;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Jira tasks and bugs committed to a delivery date, grouped by delivery.
        </p>
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
            }}
          >
            Clear filters
          </Button>
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
          <p className="text-xs text-muted-foreground">No deliveries match these filters.</p>
        </div>
      )}
      {filteredDeliveries?.map((delivery) => (
        <DeliveryCard key={delivery.id} delivery={delivery} canManage={canManage} onChanged={load} />
      ))}
    </div>
  );
}

function daysBetween(dateStr: string, today: string): number {
  const d = new Date(dateStr + "T00:00:00");
  const t = new Date(today + "T00:00:00");
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
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
  canManage,
  onChanged,
}: {
  delivery: DeliveryWithItems;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [addingIssues, setAddingIssues] = useState<IssueResult[]>([]);
  const [adding, setAdding] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const today = localDateStr(new Date());
  const daysToGo = daysBetween(delivery.deliveryDate, today);
  const overdue = daysToGo < 0;

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

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 p-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{delivery.name}</p>
            <Badge variant="outline" className="text-[10px] tabular-nums">
              {delivery.deliveryDate}
            </Badge>
            <span className={cn("text-[11px] font-medium", overdue ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
              {overdue ? `Overdue by ${Math.abs(daysToGo)}d` : daysToGo === 0 ? "Due today" : `${daysToGo}d to go`}
            </span>
          </div>
          {delivery.responsibleNames.length > 0 && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Responsible: {delivery.responsibleNames.join(", ")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <RollupCounts rollup={delivery.rollup} />
          {canManage && (
            <div className="flex items-center gap-1">
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

      {canManage && (
        <div className="flex items-center gap-2 border-b border-border p-2.5">
          <div className="flex-1">
            <IssueMultiPicker projectId={delivery.projectId} value={addingIssues} onChange={setAddingIssues} />
          </div>
          {addingIssues.length > 0 && (
            <Button size="sm" onClick={handleAddIssues} disabled={adding}>
              {adding ? "Adding…" : `Add ${addingIssues.length}`}
            </Button>
          )}
        </div>
      )}

      {delivery.items.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-xs text-muted-foreground">No issues committed to this delivery yet.</p>
        </div>
      ) : (
        <DeliveryItemsTable deliveryId={delivery.id} items={delivery.items} canManage={canManage} onRemoveItem={handleRemoveItem} onChanged={onChanged} />
      )}
    </div>
  );
}

function DeliveryItemsTable({
  deliveryId,
  items,
  canManage,
  onRemoveItem,
  onChanged,
}: {
  deliveryId: string;
  items: DeliveryItemRow[];
  canManage: boolean;
  onRemoveItem: (itemId: string) => void;
  onChanged: () => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/20">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Key</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Summary</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Priority</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Assignee</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Delivery</th>
            <th className="px-2 py-2" />
            {canManage && <th className="w-8 px-2 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {items.map((item) => {
            const sStyles = statusCategoryStyles(item.jiraStatus);
            const pStyles = priorityStyles(item.priority);
            return (
              <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1 font-mono font-medium text-foreground">
                    {item.jiraKey}
                    <RiExternalLinkLine className="size-3 opacity-40" />
                  </span>
                </td>
                <td className="px-3 py-2 max-w-[240px]">
                  <span className="block truncate" title={item.summary}>{item.summary}</span>
                </td>
                <td className="px-3 py-2">
                  <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold", sStyles.badge)}>
                    {item.jiraStatus}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn("size-1.5 rounded-full", pStyles.dot)} />
                    <span className={cn("font-medium", pStyles.text)}>{item.priority ?? "—"}</span>
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{item.assigneeName ?? "—"}</td>
                <td className="px-3 py-2">
                  <DeliveryStatusCell deliveryId={deliveryId} item={item} onUpdated={onChanged} />
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-0.5">
                    <DelayLogButton issueId={item.issueId} />
                    <DeliveryBadge issueId={item.issueId} canManage={canManage} onChanged={onChanged} />
                  </div>
                </td>
                {canManage && (
                  <td className="px-2 py-2">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Remove from delivery"
                      onClick={() => onRemoveItem(item.id)}
                    >
                      <RiCloseLine className="size-3.5" />
                    </Button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
 * recolor immediately too — the "vice versa" of attaching an issue.
 */
function DeliveryStatusCell({
  deliveryId,
  item,
  onUpdated,
}: {
  deliveryId: string;
  item: DeliveryItemRow;
  onUpdated: () => void;
}) {
  const [status, setStatus] = useState<DeliveryStatusValue>(item.status);
  const [comment, setComment] = useState(item.statusComment ?? "");
  const [commentOpen, setCommentOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus(item.status);
    setComment(item.statusComment ?? "");
  }, [item.status, item.statusComment]);

  async function save(nextStatus: DeliveryStatusValue, nextComment: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/deliveries/${deliveryId}/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, statusComment: nextComment.trim() || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await refreshDeliverySummary(item.issueId);
      onUpdated();
      return true;
    } catch (e) {
      setStatus(item.status);
      setComment(item.statusComment ?? "");
      toast.error(e instanceof Error ? e.message : "Failed to update status");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function handleStatusChange(value: string) {
    const next = value as DeliveryStatusValue;
    setStatus(next);
    save(next, comment);
  }

  async function handleSaveComment() {
    const ok = await save(status, comment);
    if (ok) setCommentOpen(false);
  }

  const styles = deliveryStatusStyles(status);

  return (
    <div className="flex items-center gap-1">
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
      <Popover open={commentOpen} onOpenChange={setCommentOpen}>
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
          <Button size="sm" className="w-full" onClick={handleSaveComment} disabled={saving}>
            {saving ? "Saving…" : "Save comment"}
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
