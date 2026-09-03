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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SprintWithItems } from "@/lib/sprints/entries";

/**
 * Create-or-edit form for a Sprint — mirrors CreateDeliveryForm's shape
 * (POST on create, PATCH on edit, same dialog skeleton) with sprint fields:
 * name, optional goal, start date, end date.
 */
export function CreateSprintForm({
  projectId,
  boardId,
  sprint,
  workstreams,
  trigger,
  onSaved,
}: {
  /** Owner for creation — exactly one of projectId (project sprint) / boardId (Team Pulse board sprint). Ignored when editing. */
  projectId?: string | null;
  boardId?: string | null;
  /** When set, this form edits the given sprint instead of creating a new one. */
  sprint?: SprintWithItems;
  /** Project workstreams — shows an optional "create inside workstream" picker (create mode, project sprints only). */
  workstreams?: { id: string; name: string }[];
  trigger: React.ReactNode;
  onSaved: (sprint: SprintWithItems) => void;
}) {
  const isEdit = !!sprint;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(sprint?.name ?? "");
  const [goal, setGoal] = useState(sprint?.goal ?? "");
  const [startDate, setStartDate] = useState(sprint?.startDate ?? "");
  const [endDate, setEndDate] = useState(sprint?.endDate ?? "");
  const [workstreamId, setWorkstreamId] = useState<string>("none");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showWorkstreamPicker = !isEdit && !!projectId && (workstreams?.length ?? 0) > 0;

  const canSubmit = !!name.trim() && !!startDate && !!endDate && endDate >= startDate && !submitting;

  function resetForCreate() {
    setName("");
    setGoal("");
    setStartDate("");
    setEndDate("");
    setWorkstreamId("none");
    setError(null);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const createUrl = projectId
        ? `/api/projects/${projectId}/sprints`
        : `/api/observer/boards/${boardId}/sprints`;
      const res = await fetch(isEdit ? `/api/sprints/${sprint.id}` : createUrl, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          goal: goal.trim() || null,
          startDate,
          endDate,
          ...(showWorkstreamPicker && workstreamId !== "none" ? { workstreamId } : {}),
        }),
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
          {showWorkstreamPicker && (
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Workstream (optional)</Label>
              <Select value={workstreamId} onValueChange={setWorkstreamId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No workstream</SelectItem>
                  {workstreams!.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full">
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Create sprint"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
