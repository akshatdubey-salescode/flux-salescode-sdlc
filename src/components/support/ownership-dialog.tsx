"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RiDeleteBinLine } from "@remixicon/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { OwnerSide } from "@/lib/support/types";
import { formatIstDateTime, fromIstInputValue, toIstInputValue } from "@/lib/support/ist-input";

export const SIDE_LABELS: Record<OwnerSide, string> = {
  salescode: "Salescode",
  client: "Client",
};

type HistoryEvent = {
  id: string;
  side: OwnerSide;
  at: string;
  createdAt: string;
  byName: string | null;
  deletedAt: string | null;
  deletedByName: string | null;
};

type Props = {
  projectId: string;
  issueId: string;
  /** Shown in the title, e.g. "SUP-12". */
  jiraKey?: string;
  /** Side pre-selected in the "record a change" form; null = history only. */
  initialSide?: OwnerSide | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after an event is added or deleted, so the caller can refetch. */
  onChanged: () => void;
};

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Records a Salescode ↔ Client ownership change (optionally backdated) and
 * shows the ticket's full ownership history, including deleted events.
 * Mount with a fresh `key` per open so the form resets.
 */
export function OwnershipDialog({
  projectId,
  issueId,
  jiraKey,
  initialSide = null,
  open,
  onOpenChange,
  onChanged,
}: Props) {
  const [side, setSide] = useState<OwnerSide>(initialSide ?? "salescode");
  const [at, setAt] = useState(() => toIstInputValue(new Date()));
  const [saving, setSaving] = useState(false);
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const base = `/api/projects/${projectId}/support/tickets/${issueId}/ownership`;

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(base);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { events: HistoryEvent[] };
      setEvents(data.events);
      setHistoryError(false);
    } catch {
      setHistoryError(true);
    }
  }, [base]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(base)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { events: HistoryEvent[] };
      })
      .then((data) => {
        if (cancelled) return;
        setEvents(data.events);
        setHistoryError(false);
      })
      .catch(() => {
        if (!cancelled) setHistoryError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, base]);

  async function handleConfirm() {
    const when = fromIstInputValue(at);
    if (!when) {
      toast.error("Enter a valid date and time");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ side, at: when.toISOString() }),
      });
      if (!res.ok) {
        toast.error(await errorMessage(res, "Failed to record ownership change"));
        return;
      }
      toast.success(`Ownership set to ${SIDE_LABELS[side]}`);
      onChanged();
      onOpenChange(false);
    } catch {
      toast.error("Failed to record ownership change");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(eventId: string) {
    setDeletingId(eventId);
    try {
      const res = await fetch(`${base}/${eventId}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(await errorMessage(res, "Failed to delete event"));
        return;
      }
      toast.success("Ownership event deleted");
      await loadHistory();
      onChanged();
    } catch {
      toast.error("Failed to delete event");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Ownership{jiraKey ? ` · ${jiraKey}` : ""}</DialogTitle>
          <DialogDescription>
            Salescode time only counts while Salescode owns the ticket. Backdate the change if it
            happened earlier.
          </DialogDescription>
        </DialogHeader>

        {initialSide !== null && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ownership-side">Now owned by</Label>
              <Select value={side} onValueChange={(v) => setSide(v as OwnerSide)}>
                <SelectTrigger id="ownership-side" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="salescode">{SIDE_LABELS.salescode}</SelectItem>
                  <SelectItem value="client">{SIDE_LABELS.client}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ownership-at">Since (IST)</Label>
              <Input
                id="ownership-at"
                type="datetime-local"
                value={at}
                onChange={(e) => setAt(e.target.value)}
              />
            </div>
          </div>
        )}

        {initialSide !== null && <Separator />}

        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">History</h4>
          {historyError ? (
            <p className="text-xs text-destructive">Could not load the history.</p>
          ) : events === null ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-5/6" />
            </div>
          ) : events.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No changes recorded. The ticket has been with Salescode since it was created.
            </p>
          ) : (
            <div className="max-h-64 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                    <th className="px-3 py-2 text-left font-medium text-zinc-500">Side</th>
                    <th className="px-3 py-2 text-left font-medium text-zinc-500">At (IST)</th>
                    <th className="px-3 py-2 text-left font-medium text-zinc-500">By</th>
                    <th className="px-3 py-2 text-left font-medium text-zinc-500">Entered (IST)</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {events.map((ev) => {
                    const deleted = ev.deletedAt !== null;
                    return (
                      <tr
                        key={ev.id}
                        className={deleted ? "text-zinc-400 line-through" : "text-zinc-700 dark:text-zinc-300"}
                        title={
                          deleted
                            ? `Deleted ${formatIstDateTime(ev.deletedAt!)}${ev.deletedByName ? ` by ${ev.deletedByName}` : ""}`
                            : undefined
                        }
                      >
                        <td className="px-3 py-2">{SIDE_LABELS[ev.side]}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatIstDateTime(ev.at)}</td>
                        <td className="px-3 py-2">{ev.byName ?? "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatIstDateTime(ev.createdAt)}</td>
                        <td className="px-3 py-1 text-right">
                          {!deleted && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="Delete event"
                                  disabled={deletingId !== null}
                                >
                                  <RiDeleteBinLine />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete this ownership event?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {SIDE_LABELS[ev.side]} since {formatIstDateTime(ev.at)} will stop
                                    counting towards Salescode time. It stays in the history, struck
                                    through.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDelete(ev.id)}>
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {initialSide !== null ? "Cancel" : "Close"}
          </Button>
          {initialSide !== null && (
            <Button onClick={handleConfirm} disabled={saving}>
              {saving ? "Saving…" : "Confirm"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
