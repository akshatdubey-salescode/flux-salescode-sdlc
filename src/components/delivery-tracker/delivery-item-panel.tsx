"use client";

import { useCallback, useEffect, useState } from "react";
import { RiExternalLinkLine, RiCloseLine } from "@remixicon/react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  DELIVERY_STATUSES,
  deliveryStatusLabel,
  deliveryStatusStyles,
  isDeliveredLate,
  type DeliveryStatusValue,
} from "@/lib/deliveries/status";
import type { IssueDeliveriesDetail, IssueDeliveryMembership } from "@/lib/deliveries/entries";
import { patchDeliverySummary } from "./delivery-summary-cache";
import { DelayLogButton } from "@/components/delay-tracker/delay-log-button";
import { DeliveryHistory } from "./delivery-history";

/**
 * Jira details + every active delivery this issue belongs to (an issue can
 * be a member of several at once) — the content shared by <DeliveryBadge>'s
 * popup everywhere it's dropped in. Mirrors DelayTrackerPanel's "one issue,
 * many records" shape, but each membership is current-state only (status +
 * comment), not an append-only history.
 */
export function DeliveryItemPanel({
  issueId,
  canManage = false,
  onChanged,
}: {
  issueId: string;
  /** Shows a "Remove from this delivery" control per membership row — restricted to admins/delivery managers, same gate as every other delivery mutation. */
  canManage?: boolean;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<IssueDeliveriesDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(
    (signal?: AbortSignal) => {
      // no-store: see delivery-summary-cache.ts's refreshDeliverySummary for
      // why — the browser's default fetch cache can serve a stale response
      // for this exact URL even when the server-side data is already fresh.
      return fetch(`/api/deliveries/for-issue/${issueId}`, { signal, cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((d: IssueDeliveriesDetail) => {
          setDetail(d);
          patchDeliverySummary(issueId, d.memberships);
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof Error ? e.message : "Failed to load");
        });
    },
    [issueId]
  );

  useEffect(() => {
    const controller = new AbortController();
    loadDetail(controller.signal);
    return () => controller.abort();
  }, [loadDetail]);

  // A status change on ONE membership mirrors server-side to every other
  // delivery this issue belongs to (see the PATCH route) — a full refetch
  // is the only way every membership row in THIS SAME popup picks up that
  // mirrored status too, not just the one that was just edited.
  async function handleSaved() {
    await loadDetail();
    onChanged?.();
  }

  function handleRemoved(itemId: string) {
    if (!detail) return;
    const memberships = detail.memberships.filter((m) => m.itemId !== itemId);
    setDetail({ ...detail, memberships });
    patchDeliverySummary(issueId, memberships);
    onChanged?.();
  }

  return (
    <div>
      {!detail && !error && <PanelSkeleton />}
      {error && !detail && <p className="text-xs text-destructive">Failed to load: {error}</p>}
      {error && detail && <p className="text-xs text-destructive">Refresh failed: {error}</p>}

      {detail && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <a
                  href={`${detail.issue.jiraBaseUrl.replace(/\/$/, "")}/browse/${detail.issue.jiraKey}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-foreground hover:underline"
                >
                  {detail.issue.jiraKey}
                  <RiExternalLinkLine className="size-3 opacity-60" />
                </a>
                <DelayLogButton issueId={issueId} />
              </div>
              <span className="text-[11px] text-muted-foreground">{detail.issue.projectName}</span>
            </div>
            <p className="mt-1 text-sm font-medium text-foreground">{detail.issue.summary}</p>
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{detail.issue.status}</span>
              {detail.issue.priority && <span>· {detail.issue.priority}</span>}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              Deliveries ({detail.memberships.length})
            </p>
            {detail.memberships.length === 0 ? (
              <p className="text-xs text-muted-foreground">Not committed to any delivery yet.</p>
            ) : (
              <div className="space-y-2">
                {detail.memberships.map((m) => (
                  <MembershipRow
                    key={m.itemId}
                    membership={m}
                    canManage={canManage}
                    onSaved={handleSaved}
                    onRemoved={handleRemoved}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              Delivery history
            </p>
            <DeliveryHistory issueId={issueId} />
          </div>
        </div>
      )}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-border/60 p-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="h-32 w-full rounded-lg" />
    </div>
  );
}

function MembershipRow({
  membership,
  canManage,
  onSaved,
  onRemoved,
}: {
  membership: IssueDeliveryMembership;
  canManage: boolean;
  /** A status change here mirrors server-side to every other delivery this issue belongs to — this asks the parent to refetch the full list rather than patching just this one row. */
  onSaved: () => Promise<void>;
  onRemoved: (itemId: string) => void;
}) {
  const [status, setStatus] = useState<DeliveryStatusValue>(membership.status);
  const [comment, setComment] = useState(membership.statusComment ?? "");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = status !== membership.status || comment.trim() !== (membership.statusComment ?? "");
  // Late-delivery styling reflects the SAVED outcome (status/statusSetAt as
  // recorded server-side), not an in-progress draft — a dirty draft can't
  // yet know its own statusSetAt, so it just shows the plain status color
  // until saved, then this recomputes from the refreshed membership.
  const isLate = status === membership.status && isDeliveredLate(membership.status, membership.deliveryDate, membership.statusSetAt);
  const styles = deliveryStatusStyles(status, isLate);

  async function handleRemove() {
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/deliveries/${membership.deliveryId}/items/${membership.itemId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onRemoved(membership.itemId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove");
      setRemoving(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/deliveries/${membership.deliveryId}/items/${membership.itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, statusComment: comment.trim() || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", styles.badge)}>
            {deliveryStatusLabel(status)}
          </span>
          <span className="text-xs font-medium text-foreground">{membership.deliveryName}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">{membership.deliveryDate}</span>
          {canManage && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Remove from this delivery"
              aria-label="Remove from this delivery"
              onClick={handleRemove}
              disabled={removing}
            >
              <RiCloseLine className="size-3.5 text-muted-foreground hover:text-destructive" />
            </Button>
          )}
        </div>
      </div>

      <Select value={status} onValueChange={(v) => setStatus(v as DeliveryStatusValue)}>
        <SelectTrigger size="sm" className="w-full">
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

      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional comment…"
        className="min-h-14 text-xs"
      />

      {error && <p className="text-xs text-destructive">{error}</p>}
      {membership.statusSetByName && (
        <p className="text-[10px] text-muted-foreground/70">
          Last set by {membership.statusSetByName}
          {membership.statusSetAt ? ` on ${formatDateTime(membership.statusSetAt)}` : ""}
        </p>
      )}
      {dirty && (
        <Button size="sm" onClick={handleSave} disabled={saving} className="w-full">
          {saving ? "Saving…" : "Save"}
        </Button>
      )}
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
