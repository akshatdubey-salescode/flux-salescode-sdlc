"use client";

import { useEffect, useRef, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiblePeoplePicker, type Person } from "./responsible-people-picker";
import type { DeliveryWithItems } from "@/lib/deliveries/entries";
import type { SprintOption } from "@/lib/sprints/entries";

/** The sprint a new delivery is cut from — its name and end date pre-fill the form, and every active item comes across. */
export type DeliverySourceSprint = { id: string; name: string; endDate: string; itemCount: number };

function pluralIssues(n: number): string {
  return `${n} issue${n === 1 ? "" : "s"}`;
}

/**
 * Create-or-edit form for a Delivery — the same fields either way (name,
 * date, notify-lead-time, responsible people), just POSTing on create and
 * PATCHing on edit. Reused by the tab's "New delivery" button, Project
 * Tracking's per-issue "create new delivery" action (via initialIssueId),
 * the sprint card's "Create delivery from this sprint" (via fromSprint),
 * and each delivery card's "Edit" action. In plain create mode it also
 * offers to seed the delivery from one of the project's sprints.
 */
export function CreateDeliveryForm({
  projectId,
  delivery,
  initialIssueId,
  fromSprint,
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
  /**
   * When creating, seeds the delivery from this sprint: name and end date
   * pre-fill the form (still editable) and every active sprint item is
   * attached in the same request. Fixed source — the in-form sprint picker
   * is hidden. Key the form on the sprint's name/date if those can change
   * while it stays mounted; the pre-fill is read once at mount.
   */
  fromSprint?: DeliverySourceSprint;
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
  const [name, setName] = useState(delivery?.name ?? fromSprint?.name ?? "");
  const [deliveryDate, setDeliveryDate] = useState(delivery?.deliveryDate ?? fromSprint?.endDate ?? "");
  const [notifyDaysBefore, setNotifyDaysBefore] = useState(delivery?.notifyDaysBefore ?? 5);
  const [responsible, setResponsible] = useState<Person[]>(
    delivery ? delivery.responsibleEmails.map((email, i) => ({ email, name: delivery.responsibleNames[i] ?? email })) : []
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sprint source. Either fixed via `fromSprint`, or picked from this
  // project's sprints (loaded the first time the dialog opens). The
  // per-issue flow (initialIssueId) stays focused on its one issue.
  const showSprintPicker = !isEdit && !fromSprint && !initialIssueId;
  const [sprintOptions, setSprintOptions] = useState<SprintOption[] | null>(null);
  const [sprintId, setSprintId] = useState<string>("none");
  const pickedSprint = sprintOptions?.find((s) => s.id === sprintId);
  const sourceSprint: DeliverySourceSprint | null =
    fromSprint ??
    (pickedSprint
      ? { id: pickedSprint.id, name: pickedSprint.name, endDate: pickedSprint.endDate, itemCount: pickedSprint.itemCount }
      : null);
  // What the sprint last wrote into name/date — so switching sprints replaces
  // OUR pre-fill but never clobbers something the user typed themselves.
  const autoFilled = useRef({ name: fromSprint?.name ?? "", date: fromSprint?.endDate ?? "" });

  useEffect(() => {
    if (!open || !showSprintPicker || sprintOptions !== null) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/sprints?summary=1&includeCompleted=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { sprints: SprintOption[] }) => {
        if (!cancelled) setSprintOptions(d.sprints ?? []);
      })
      .catch(() => {
        // No picker rather than a broken one — the delivery can still be
        // created empty and filled from its card.
        if (!cancelled) setSprintOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, showSprintPicker, sprintOptions, projectId]);

  function applySprintDefaults(sprint: DeliverySourceSprint | null) {
    const prev = autoFilled.current;
    const nextName = sprint?.name ?? "";
    const nextDate = sprint?.endDate ?? "";
    setName((cur) => (!cur.trim() || cur === prev.name ? nextName : cur));
    setDeliveryDate((cur) => (!cur || cur === prev.date ? nextDate : cur));
    autoFilled.current = { name: nextName, date: nextDate };
  }

  function handleSprintChange(next: string) {
    setSprintId(next);
    const s = sprintOptions?.find((o) => o.id === next);
    applySprintDefaults(s ? { id: s.id, name: s.name, endDate: s.endDate, itemCount: s.itemCount } : null);
  }

  const canSubmit = !!name.trim() && !!deliveryDate && notifyDaysBefore >= 0 && !submitting;

  function resetForCreate() {
    autoFilled.current = { name: fromSprint?.name ?? "", date: fromSprint?.endDate ?? "" };
    setName(fromSprint?.name ?? "");
    setDeliveryDate(fromSprint?.endDate ?? "");
    setNotifyDaysBefore(5);
    setResponsible([]);
    setSprintId("none");
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
          ...(isEdit ? {} : { initialIssueId, fromSprintId: sourceSprint?.id }),
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
              : fromSprint
                ? "Turn this sprint's scope into a client-facing delivery — a named batch of Jira tasks/bugs committed to ship by one date."
                : "A named batch of Jira tasks/bugs committed to ship by one date."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {showSprintPicker && sprintOptions && sprintOptions.length > 0 && (
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Create from sprint (optional)</Label>
              <Select value={sprintId} onValueChange={handleSprintChange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No sprint — start empty</SelectItem>
                  {sprintOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} · {pluralIssues(s.itemCount)}
                      {s.completedAt ? " · completed" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {sourceSprint && (
            <p className="rounded-md border border-border bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground">
              From sprint <span className="font-medium text-foreground">{sourceSprint.name}</span>
              {sourceSprint.itemCount > 0
                ? ` — its ${pluralIssues(sourceSprint.itemCount)} are added to this delivery.`
                : " — it has no issues yet; add them from the delivery card afterwards."}{" "}
              Name and date below are pre-filled from the sprint; change them freely.
            </p>
          )}
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
