"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ResponsiblePeoplePicker, type Person } from "./responsible-people-picker";
import type { DeliveryWithItems } from "@/lib/deliveries/entries";

/**
 * Create-or-edit form for a Delivery — the same fields either way (name,
 * date, notify-lead-time, responsible people), just POSTing on create and
 * PATCHing on edit. Reused by the tab's "New delivery" button, Project
 * Tracking's per-issue "create new delivery" action (via initialIssueId),
 * and each delivery card's "Edit" action.
 */
export function CreateDeliveryForm({
  projectId,
  delivery,
  initialIssueId,
  trigger,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  onSaved,
}: {
  projectId: string;
  /** When set, this form edits the given delivery instead of creating a new one. */
  delivery?: DeliveryWithItems;
  /** When creating (no `delivery`), attaches this issue as the delivery's first item in the same request. */
  initialIssueId?: string;
  /** Omit when externally controlled (open/onOpenChange) — e.g. opened from a menu item that must close its own popover first, where nesting a DialogTrigger inside that popover would fight over focus/outside-click handling. */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSaved: (delivery: DeliveryWithItems) => void;
}) {
  const isEdit = !!delivery;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = setControlledOpen ?? setInternalOpen;
  const [name, setName] = useState(delivery?.name ?? "");
  const [deliveryDate, setDeliveryDate] = useState(delivery?.deliveryDate ?? "");
  const [notifyDaysBefore, setNotifyDaysBefore] = useState(delivery?.notifyDaysBefore ?? 5);
  const [responsible, setResponsible] = useState<Person[]>(
    delivery ? delivery.responsibleEmails.map((email, i) => ({ email, name: delivery.responsibleNames[i] ?? email })) : []
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !!name.trim() && !!deliveryDate && notifyDaysBefore >= 0 && !submitting;

  function resetForCreate() {
    setName("");
    setDeliveryDate("");
    setNotifyDaysBefore(5);
    setResponsible([]);
    setError(null);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(isEdit ? `/api/deliveries/${delivery.id}` : `/api/projects/${projectId}/deliveries`, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          deliveryDate,
          notifyDaysBefore,
          responsibleEmails: responsible.map((p) => p.email),
          responsibleNames: responsible.map((p) => p.name),
          ...(isEdit ? {} : { initialIssueId }),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { delivery: saved } = (await res.json()) as { delivery: DeliveryWithItems };
      onSaved(saved);
      setOpen(false);
      if (!isEdit) resetForCreate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit delivery" : "Create delivery"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Delays happen — the date, notify window, and responsible people can all be changed."
              : "A named batch of Jira tasks/bugs committed to ship by one date."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Release 4.2" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Delivery date</Label>
              <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Notify (days before)</Label>
              <Input
                type="number"
                min={0}
                value={notifyDaysBefore}
                onChange={(e) => setNotifyDaysBefore(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Responsible people</Label>
            <ResponsiblePeoplePicker value={responsible} onChange={setResponsible} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full">
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Create delivery"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
