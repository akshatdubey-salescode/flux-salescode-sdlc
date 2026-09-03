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
import type { SprintWithItems } from "@/lib/sprints/entries";

/**
 * Create-or-edit form for a Sprint — mirrors CreateDeliveryForm's shape
 * (POST on create, PATCH on edit, same dialog skeleton) with sprint fields:
 * name, optional goal, start date, end date.
 */
export function CreateSprintForm({
  projectId,
  sprint,
  trigger,
  onSaved,
}: {
  projectId: string;
  /** When set, this form edits the given sprint instead of creating a new one. */
  sprint?: SprintWithItems;
  trigger: React.ReactNode;
  onSaved: (sprint: SprintWithItems) => void;
}) {
  const isEdit = !!sprint;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(sprint?.name ?? "");
  const [goal, setGoal] = useState(sprint?.goal ?? "");
  const [startDate, setStartDate] = useState(sprint?.startDate ?? "");
  const [endDate, setEndDate] = useState(sprint?.endDate ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !!name.trim() && !!startDate && !!endDate && endDate >= startDate && !submitting;

  function resetForCreate() {
    setName("");
    setGoal("");
    setStartDate("");
    setEndDate("");
    setError(null);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(isEdit ? `/api/sprints/${sprint.id}` : `/api/projects/${projectId}/sprints`, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), goal: goal.trim() || null, startDate, endDate }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { sprint: saved } = (await res.json()) as { sprint: SprintWithItems };
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
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit sprint" : "Create sprint"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Rename the sprint, refine its goal, or shift the time box."
              : "An internal time-boxed iteration. It starts as Planned — add candidate issues freely, then Start it to lock the commitment. Progress rolls up automatically from Jira status; see “How sprints work” on the tab for the full rules."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sprint 24" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Goal (optional)</Label>
            <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What this iteration is for" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Start date</Label>
              <Input type="date" value={startDate} max={endDate || undefined} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">End date</Label>
              <Input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full">
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Create sprint"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
