"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  RiAddLine,
  RiPencilLine,
  RiDeleteBinLine,
  RiExternalLinkLine,
  RiCheckboxCircleLine,
  RiPlayLine,
  RiFlag2Line,
  RiDownload2Line,
  RiChat3Line,
  RiFileCopyLine,
  RiCheckLine,
  RiFullscreenLine,
  RiLinkM,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { localDateStr } from "@/lib/date-utils";
import { classifyIssue } from "@/lib/jira/estimate";
import { statusCategoryStyles, priorityStyles, issueTypeStyles } from "@/components/project-tracking/helpers";
import { IssueMultiPicker, type IssueResult } from "@/components/delivery-tracker/issue-multi-picker";
import type { SprintWithItems, SprintItemRow } from "@/lib/sprints/entries";
import { CreateSprintForm } from "./create-sprint-form";
import { SprintGuide } from "./sprint-guide";
import { ItemCommentsModal } from "./item-comments-modal";

type SprintsResponse = { sprints: SprintWithItems[] };

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);
}

/** Standard Scrum lifecycle — driven by the explicit start/complete actions, not the calendar. */
type SprintPhase = "planned" | "active" | "completed";

function sprintPhase(sprint: SprintWithItems): SprintPhase {
  if (sprint.completedAt) return "completed";
  if (sprint.startedAt) return "active";
  return "planned";
}

const PHASE_STYLES: Record<SprintPhase, string> = {
  planned: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  active: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
};

function formatPlanDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Actual Start/End are full datetimes, so parse the ISO string directly (same as the delivery table). */
function formatActualDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type ItemRisk = "overdue" | "at_risk" | "unplanned" | null;

/**
 * Same classification the Team Tracking at-risk/overdue/unplanned views use
 * (classifyIssue: overdue = due date past; at risk = ≤20% of working hours
 * left), applied per sprint item. Missing dates → "unplanned", done → null.
 */
function itemRisk(item: SprintItemRow, nowStr: string): ItemRisk {
  if (item.progress === "done") return null;
  if (!item.startDate || !item.dueDate) return "unplanned";
  const label = classifyIssue(item.statusCategory, item.startDate, item.dueDate, nowStr);
  if (label === "overdue" || label === "at_risk") return label;
  return null;
}

const RISK_STYLES: Record<Exclude<ItemRisk, null>, { label: string; badge: string }> = {
  overdue: { label: "Overdue", badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  at_risk: { label: "At risk", badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  unplanned: { label: "Unplanned", badge: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" },
};

const PROGRESS_LABELS: Record<SprintItemRow["progress"], string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
};

/** Plain-text sprint update for pasting into Slack/WhatsApp groups — mirrors buildDeliveryAlertMessage's shape on the deliveries tab. */
function buildSprintUpdateMessage(sprint: SprintWithItems, phaseText: string): string {
  const r = sprint.rollup;
  const dateLabel = new Date().toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
  const pct = r.committed > 0 ? Math.round((r.committedDone / r.committed) * 100) : 0;
  const lines: string[] = [
    `🏃 ${sprint.name} — ${sprint.startDate} → ${sprint.endDate} (${phaseText}) — as of ${dateLabel}`,
  ];
  if (sprint.goal) lines.push(`Goal: ${sprint.goal}`);
  if (sprint.startedAt) {
    lines.push(
      `Committed ${r.committed} · Completed ${r.committedDone} of ${r.committed} (${pct}%)` +
        (r.addedAfterStart > 0 ? ` · Added after start ${r.addedAfterStart}` : "") +
        (r.removed > 0 ? ` · Removed ${r.removed}` : "") +
        (r.carriedOver > 0 ? ` · Carried in ${r.carriedOver}` : "")
    );
  }
  lines.push(`Overall: ${r.done} done · ${r.inProgress} in progress · ${r.todo} to do (of ${r.total})`);
  for (const item of sprint.items) {
    const scope = !sprint.startedAt ? "" : item.committed ? "" : " *added mid-sprint*";
    lines.push(`  • ${item.jiraKey} — ${item.summary} [${PROGRESS_LABELS[item.progress]}]${scope}`);
  }
  if (sprint.removedItems.length > 0) {
    lines.push(`Removed after start:`);
    for (const item of sprint.removedItems) {
      lines.push(`  • ${item.jiraKey} — ${item.summary}${item.removedComment ? ` ("${item.removedComment}")` : ""}`);
    }
  }
  return lines.join("\n");
}

function sprintMatchesSearch(sprint: SprintWithItems, query: string): boolean {
  const q = query.toLowerCase();
  if (sprint.name.toLowerCase().includes(q)) return true;
  if ((sprint.goal ?? "").toLowerCase().includes(q)) return true;
  if (sprint.items.some((i) => i.jiraKey.toLowerCase().includes(q))) return true;
  return false;
}

/** The shareable deep link to one sprint's full-screen page — resolves for anyone who can open the project. */
function sprintLink(sprintId: string): string {
  return `${window.location.origin}/sprints/${sprintId}`;
}

export function SprintTrackerTab({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sprints, setSprints] = useState<SprintWithItems[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);

  // Compat: earlier shared links used ?sprint=<id> on this tab — forward them
  // to the sprint's full-screen page, which is where zoom lives now.
  const legacyFocusId = searchParams.get("sprint");
  useEffect(() => {
    if (legacyFocusId) router.replace(`/sprints/${legacyFocusId}`);
  }, [legacyFocusId, router]);

  const load = useCallback(() => {
    // no-store for the same reason the deliveries tab uses it: this list is
    // re-fetched right after mutations, and a browser-cached response would
    // silently undo the reload.
    fetch(`/api/projects/${projectId}/sprints`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: SprintsResponse) => setSprints(d.sprints))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleSprints = useMemo(() => {
    let list = sprints ?? [];
    if (!showCompleted) list = list.filter((s) => !s.completedAt);
    if (search.trim()) list = list.filter((s) => sprintMatchesSearch(s, search.trim()));
    return list;
  }, [sprints, showCompleted, search]);

  // Velocity, issue-count based: average committed-work completion across
  // the most recent closed sprints (up to 5) — the number a velocity chart
  // would plot, shown as one line until there are enough sprints to chart.
  const velocity = useMemo(() => {
    const closed = (sprints ?? [])
      .filter((s) => s.completedAt && s.rollup.committed > 0)
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
      .slice(0, 5);
    if (closed.length === 0) return null;
    const avgDone = closed.reduce((sum, s) => sum + s.rollup.committedDone, 0) / closed.length;
    const avgPct =
      closed.reduce((sum, s) => sum + s.rollup.committedDone / s.rollup.committed, 0) / closed.length;
    return { sprints: closed.length, avgDone, avgPct: Math.round(avgPct * 100) };
  }, [sprints]);

  if (error) {
    return <p className="text-xs text-destructive">Failed to load sprints: {error}</p>;
  }
  if (!sprints) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sprints by name, goal, or issue key…"
          className="h-8 w-72"
        />
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Switch checked={showCompleted} onCheckedChange={setShowCompleted} />
          Show completed
        </label>
        {velocity && (
          <span className="text-[11px] text-muted-foreground">
            Velocity (last {velocity.sprints} closed): {velocity.avgDone.toFixed(1)} committed issues done per sprint
            · {velocity.avgPct}% of commitment
          </span>
        )}
        <div className="flex-1" />
        <SprintGuide />
        {canManage && (
          <CreateSprintForm
            projectId={projectId}
            trigger={
              <Button size="sm">
                <RiAddLine className="size-3.5" /> New sprint
              </Button>
            }
            onSaved={load}
          />
        )}
      </div>

      {visibleSprints.length === 0 ? (
        <div className="space-y-2 p-6 text-center text-xs text-muted-foreground">
          <p>
            {sprints.length === 0
              ? "No sprints yet — create one, add the planned issues, then start it to lock the commitment."
              : "No sprints match the current filters."}
          </p>
          {sprints.length === 0 && (
            <SprintGuide
              trigger={
                <button type="button" className="underline underline-offset-2 hover:text-foreground">
                  Read how sprints work before creating the first one
                </button>
              }
            />
          )}
        </div>
      ) : (
        visibleSprints.map((sprint) => (
          <SprintCard
            key={sprint.id}
            sprint={sprint}
            canManage={canManage}
            onChanged={load}
            onZoom={() => router.push(`/sprints/${sprint.id}`)}
            spilloverTargets={(sprints ?? [])
              .filter((s) => s.id !== sprint.id && !s.completedAt)
              .map((s) => ({ id: s.id, name: s.name, startDate: s.startDate, endDate: s.endDate }))}
          />
        ))
      )}
    </div>
  );
}

export type SpilloverTarget = { id: string; name: string; startDate: string; endDate: string };

export function SprintCard({
  sprint,
  canManage,
  onChanged,
  onZoom,
  spilloverTargets,
}: {
  sprint: SprintWithItems;
  canManage: boolean;
  onChanged: () => void;
  /** Opens the sprint's full-screen page; absent when already on it. */
  onZoom?: () => void;
  spilloverTargets: SpilloverTarget[];
}) {
  const [addingIssues, setAddingIssues] = useState<IssueResult[]>([]);
  const [adding, setAdding] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [updateCopied, setUpdateCopied] = useState(false);

  const existingIssueIds = useMemo(() => new Set(sprint.items.map((i) => i.issueId)), [sprint.items]);

  const today = localDateStr(new Date());
  const phase = sprintPhase(sprint);
  const totalDays = daysBetween(sprint.endDate, sprint.startDate) + 1;
  const dayOfSprint = Math.min(totalDays, Math.max(1, daysBetween(today, sprint.startDate) + 1));
  const pastEndDate = phase === "active" && today > sprint.endDate;
  const donePct = sprint.rollup.total > 0 ? Math.round((sprint.rollup.done / sprint.rollup.total) * 100) : 0;
  const unfinished = sprint.rollup.total - sprint.rollup.done;

  const phaseLabel =
    phase === "planned"
      ? "Planned — not started"
      : phase === "completed"
        ? "Completed"
        : pastEndDate
          ? "Active — past end date, close it"
          : `Active — day ${dayOfSprint} of ${totalDays}`;

  async function handleAddIssues(comment?: string) {
    if (addingIssues.length === 0) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/sprints/${sprint.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueIds: addingIssues.map((i) => i.id), ...(comment ? { comment } : {}) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to add issues");
        return;
      }
      setAddingIssues([]);
      onChanged();
    } finally {
      setAdding(false);
    }
  }

  async function handleRemoveItem(itemId: string, comment?: string) {
    const res = await fetch(`/api/sprints/${sprint.id}/items/${itemId}`, {
      method: "DELETE",
      ...(comment
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comment }) }
        : {}),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to remove item");
      return;
    }
    onChanged();
  }

  async function handleDelete() {
    await fetch(`/api/sprints/${sprint.id}`, { method: "DELETE" });
    setConfirmDeleteOpen(false);
    onChanged();
  }

  async function handleStart() {
    setStarting(true);
    try {
      const res = await fetch(`/api/sprints/${sprint.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ started: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to start sprint");
        return;
      }
      toast.success(`Sprint started — ${sprint.rollup.total} issue${sprint.rollup.total === 1 ? "" : "s"} committed`);
      onChanged();
    } finally {
      setStarting(false);
    }
  }

  function handleCopyUpdate() {
    navigator.clipboard.writeText(buildSprintUpdateMessage(sprint, phaseLabel));
    setUpdateCopied(true);
    setTimeout(() => setUpdateCopied(false), 2000);
  }

  /** Per-sprint report download — same endpoint shape as the deliveries export, single-sprint body. */
  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch("/api/sprints/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sprints: [sprint] }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();

      const safeName = sprint.name.replace(/[^\w-]+/g, "_");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}-report.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Export failed — try again");
    } finally {
      setExporting(false);
    }
  }

  async function handleReopen() {
    const res = await fetch(`/api/sprints/${sprint.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: false }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to reopen sprint");
      return;
    }
    onChanged();
  }

  return (
    <div className="rounded-lg border border-border">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{sprint.name}</h3>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                pastEndDate ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : PHASE_STYLES[phase]
              )}
            >
              {phaseLabel}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {sprint.startDate} → {sprint.endDate}
            </span>
          </div>
          {sprint.goal && (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <RiFlag2Line className="size-3 shrink-0" /> {sprint.goal}
            </p>
          )}
          <SprintReportLine sprint={sprint} phase={phase} />
          {sprint.completedAt && sprint.completedByName && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">Closed by {sprint.completedByName}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onZoom && (
            <Button variant="ghost" size="icon-sm" title="Open focused view" onClick={onZoom}>
              <RiFullscreenLine className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            title="Copy shareable link to this sprint"
            onClick={() => {
              navigator.clipboard.writeText(sprintLink(sprint.id));
              toast.success("Sprint link copied — anyone with project access can open it");
            }}
          >
            <RiLinkM className="size-3.5" />
          </Button>
          {(sprint.items.length > 0 || sprint.removedItems.length > 0) && (
            <>
              <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={handleCopyUpdate} title="Copy a plain-text sprint update for pasting into a group chat">
                {updateCopied ? (
                  <>
                    <RiCheckLine className="size-3.5" /> Copied!
                  </>
                ) : (
                  <>
                    <RiFileCopyLine className="size-3.5" /> Copy update
                  </>
                )}
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={handleExport} disabled={exporting}>
                <RiDownload2Line className="size-3.5" />
                {exporting ? "Exporting…" : "Report"}
              </Button>
            </>
          )}
          {canManage && (
          <div className="flex items-center gap-1">
            {phase === "planned" && (
              <Button size="sm" className="h-7 text-[11px]" disabled={starting} onClick={handleStart}>
                <RiPlayLine className="size-3.5" />
                {starting ? "Starting…" : "Start sprint"}
              </Button>
            )}
            {phase === "active" && (
              <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setCloseOpen(true)}>
                <RiCheckboxCircleLine className="size-3.5" /> Complete sprint
              </Button>
            )}
            {phase === "completed" && (
              <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={handleReopen}>
                Reopen
              </Button>
            )}
            <CreateSprintForm
              projectId={sprint.projectId}
              sprint={sprint}
              trigger={
                <Button variant="ghost" size="icon-sm" title="Edit sprint">
                  <RiPencilLine className="size-3.5" />
                </Button>
              }
              onSaved={onChanged}
            />
            <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
              <Button variant="ghost" size="icon-sm" title="Delete sprint" onClick={() => setConfirmDeleteOpen(true)}>
                <RiDeleteBinLine className="size-3.5" />
              </Button>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this sprint?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Its items stay in the database for history, but the sprint stops counting anywhere in the tracker.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={handleDelete}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          )}
        </div>
      </div>

      {sprint.rollup.total > 0 && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Progress value={donePct} className="flex-1" />
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {sprint.rollup.done}/{sprint.rollup.total} done ({donePct}%) · {sprint.rollup.todo} to do ·{" "}
            {sprint.rollup.inProgress} in progress
          </span>
        </div>
      )}

      {canManage && phase !== "completed" && (
        <div className="border-b border-border p-2.5">
          <IssueMultiPicker
            projectId={sprint.projectId}
            value={addingIssues}
            onChange={setAddingIssues}
            existingIssueIds={existingIssueIds}
            onSubmit={handleAddIssues}
            submitting={adding}
            scopeComment={
              phase === "active"
                ? { placeholder: "e.g. Urgent client escalation — it goes on the sprint report" }
                : undefined
            }
          />
        </div>
      )}

      {sprint.items.length === 0 ? (
        <p className="p-6 text-center text-xs text-muted-foreground">
          {phase === "planned"
            ? "No issues planned yet — add the candidate work, then start the sprint to lock the commitment."
            : "No issues in this sprint."}
        </p>
      ) : (
        <SprintItemsTable sprint={sprint} phase={phase} canManage={canManage} onRemoveItem={handleRemoveItem} />
      )}

      {sprint.removedItems.length > 0 && (
        <div className="border-t border-border px-3 py-2">
          <button
            type="button"
            onClick={() => setShowRemoved((v) => !v)}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {showRemoved ? "Hide" : "Show"} {sprint.removedItems.length} removed after start
          </button>
          {showRemoved && (
            <ul className="mt-1.5 space-y-1">
              {sprint.removedItems.map((item) => (
                <li key={item.id} className="text-[11px] text-muted-foreground">
                  <span className="font-mono line-through">{item.jiraKey}</span>{" "}
                  <span className="line-through">{item.summary}</span> — removed
                  {item.removedByName ? ` by ${item.removedByName}` : ""}
                  {item.removedAt ? ` on ${item.removedAt.slice(0, 10)}` : ""}
                  {item.removedComment ? <>: “{item.removedComment}”</> : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <CompleteSprintDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        sprint={sprint}
        unfinished={unfinished}
        targets={spilloverTargets}
        onDone={onChanged}
      />
    </div>
  );
}

/** The Jira-sprint-report line: commitment, completion of commitment, scope changes. */
function SprintReportLine({ sprint, phase }: { sprint: SprintWithItems; phase: SprintPhase }) {
  const r = sprint.rollup;
  if (phase === "planned") {
    return (
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {r.total} issue{r.total === 1 ? "" : "s"} planned — the commitment locks when the sprint starts.
      </p>
    );
  }
  const pct = r.committed > 0 ? Math.round((r.committedDone / r.committed) * 100) : 0;
  return (
    <p className="mt-0.5 text-[11px] text-muted-foreground">
      Committed <span className="font-medium text-foreground">{r.committed}</span> · completed{" "}
      <span className="font-medium text-foreground">
        {r.committedDone} of {r.committed}
      </span>{" "}
      ({pct}%)
      {r.addedAfterStart > 0 && (
        <span className="text-amber-600 dark:text-amber-400"> · {r.addedAfterStart} added after start *</span>
      )}
      {r.removed > 0 && <span> · {r.removed} removed</span>}
      {r.carriedOver > 0 && <span> · {r.carriedOver} carried in</span>}
    </p>
  );
}

function SprintItemsTable({
  sprint,
  phase,
  canManage,
  onRemoveItem,
}: {
  sprint: SprintWithItems;
  phase: SprintPhase;
  canManage: boolean;
  onRemoveItem: (itemId: string, comment?: string) => void;
}) {
  const [commentsItem, setCommentsItem] = useState<SprintItemRow | null>(null);
  // Removing from an ACTIVE sprint is a tracked scope change and needs a
  // reason — route through the dialog. Planned-sprint removals are just
  // grooming and go straight through.
  const [removeTarget, setRemoveTarget] = useState<SprintItemRow | null>(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/20">
            <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">Key</th>
            <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">Summary</th>
            <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
            <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">Risk</th>
            <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">Priority</th>
            <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">Assignee</th>
            <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">Start Date</th>
            <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">End Date</th>
            <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">Actual Start</th>
            <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">Actual End</th>
            <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">Scope</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {sprint.items.map((item) => (
            <SprintItemRowView
              key={item.id}
              item={item}
              phase={phase}
              canManage={canManage}
              onRemove={() => (phase === "active" ? setRemoveTarget(item) : onRemoveItem(item.id))}
              onComments={() => setCommentsItem(item)}
            />
          ))}
        </tbody>
      </table>
      {commentsItem && (
        <ItemCommentsModal
          jiraKey={commentsItem.jiraKey}
          jiraBaseUrl={commentsItem.jiraBaseUrl}
          summary={commentsItem.summary}
          open
          onOpenChange={(o) => {
            if (!o) setCommentsItem(null);
          }}
        />
      )}
      {removeTarget && (
        <RemoveItemDialog
          item={removeTarget}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={(comment) => {
            onRemoveItem(removeTarget.id, comment);
            setRemoveTarget(null);
          }}
        />
      )}
    </div>
  );
}

/** Reason gate for removing an item from an active sprint — the reason lands in the "removed after start" record and the report. */
function RemoveItemDialog({
  item,
  onCancel,
  onConfirm,
}: {
  item: SprintItemRow;
  onCancel: () => void;
  onConfirm: (comment: string) => void;
}) {
  const [comment, setComment] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {item.jiraKey} from this sprint?</DialogTitle>
          <DialogDescription>
            The sprint has started, so this is a tracked scope change — the item moves to the “removed after start”
            list with your reason, and both appear on the sprint report.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Reason (required)</Label>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="e.g. Deprioritized — blocked on client input until next sprint"
            rows={3}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" disabled={!comment.trim()} onClick={() => onConfirm(comment.trim())}>
            Remove from sprint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SprintItemRowView({
  item,
  phase,
  canManage,
  onRemove,
  onComments,
}: {
  item: SprintItemRow;
  phase: SprintPhase;
  canManage: boolean;
  onRemove: () => void;
  onComments: () => void;
}) {
  const status = statusCategoryStyles(item.statusCategory);
  const priority = priorityStyles(item.priority);
  const type = issueTypeStyles(item.issueType ?? "");
  const addedDate = item.addedAt.slice(0, 10);
  // Local datetime without tz suffix — the format classifyIssue expects
  // (same as the team views' `now` param).
  const now = new Date();
  const risk = itemRisk(item, `${localDateStr(now)}T${now.toTimeString().slice(0, 8)}`);

  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="px-3 py-2 whitespace-nowrap">
        <a
          href={`${item.jiraBaseUrl}/browse/${item.jiraKey}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono font-medium hover:underline"
        >
          <span className={cn("flex size-4 items-center justify-center rounded text-[10px] font-semibold", type.bg, type.text)}>
            {type.abbr}
          </span>
          {item.jiraKey}
          <RiExternalLinkLine className="size-3 opacity-50" />
        </a>
      </td>
      <td className="max-w-md truncate px-3 py-2">{item.summary}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium", status.badge)}>
          {item.jiraStatus}
        </span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {risk ? (
          <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium", RISK_STYLES[risk].badge)}>
            {RISK_STYLES[risk].label}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        {item.priority ? (
          <span className={cn("inline-flex items-center gap-1 text-[11px]", priority.text)}>
            <span className={cn("size-1.5 rounded-full", priority.dot)} />
            {item.priority}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-muted-foreground">{item.assigneeName ?? "Unassigned"}</td>
      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatPlanDate(item.startDate)}</td>
      <td
        className={cn(
          "px-3 py-2 whitespace-nowrap",
          risk === "overdue" ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground"
        )}
      >
        {formatPlanDate(item.dueDate)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatActualDate(item.actualStart)}</td>
      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatActualDate(item.actualEnd)}</td>
      <td className="px-3 py-2">
        {phase === "planned" ? (
          <span className="text-[11px] text-muted-foreground">Planned</span>
        ) : item.committed ? (
          item.carriedFromSprintName ? (
            <span className="text-[11px] text-muted-foreground" title={`Carried over from ${item.carriedFromSprintName}`}>
              Committed · ↩ {item.carriedFromSprintName}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">Committed</span>
          )
        ) : (
          <div title={item.addedComment ? `Added ${addedDate}, after the sprint started: ${item.addedComment}` : `Added ${addedDate}, after the sprint started — a scope change`}>
            <span className="text-[11px] text-amber-600 dark:text-amber-400">
              Added {addedDate} *{item.carriedFromSprintName ? ` · ↩ ${item.carriedFromSprintName}` : ""}
            </span>
            {item.addedComment && (
              <p className="max-w-48 truncate text-[10px] text-muted-foreground">“{item.addedComment}”</p>
            )}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-0.5">
          <Button variant="ghost" size="icon-sm" title="Jira comments" onClick={onComments}>
            <RiChat3Line className="size-3.5" />
          </Button>
          {canManage && (
            <Button
              variant="ghost"
              size="icon-sm"
              title={phase === "planned" ? "Remove from plan" : "Remove from sprint (tracked as scope change)"}
              onClick={onRemove}
            >
              <RiDeleteBinLine className="size-3.5" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * The standard close flow: completing a sprint makes you decide what happens
 * to unfinished work — carry it into another open sprint (it stays here too,
 * as the spillover record) or leave it in the closed sprint.
 */
function CompleteSprintDialog({
  open,
  onOpenChange,
  sprint,
  unfinished,
  targets,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sprint: SprintWithItems;
  unfinished: number;
  targets: SpilloverTarget[];
  onDone: () => void;
}) {
  const [targetId, setTargetId] = useState<string>("none");
  const [submitting, setSubmitting] = useState(false);

  async function handleComplete() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sprints/${sprint.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          completed: true,
          ...(targetId !== "none" && unfinished > 0 ? { moveIncompleteToSprintId: targetId } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to complete sprint");
        return;
      }
      toast.success(
        typeof body.carried === "number"
          ? `Sprint completed — ${body.carried} unfinished item${body.carried === 1 ? "" : "s"} carried over`
          : "Sprint completed"
      );
      onOpenChange(false);
      setTargetId("none");
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete “{sprint.name}”?</DialogTitle>
          <DialogDescription>
            {sprint.rollup.done} of {sprint.rollup.total} issue{sprint.rollup.total === 1 ? "" : "s"} done
            {unfinished > 0
              ? ` — decide what happens to the ${unfinished} unfinished one${unfinished === 1 ? "" : "s"}. Carrying over COPIES them into the next sprint (marked “↩ from ${sprint.name}”) — they also remain visible here as not done, so this sprint's report still shows what spilled over. Leaving them changes nothing; they simply stay here as not done.`
              : " — nothing to spill over."}
          </DialogDescription>
        </DialogHeader>
        {unfinished > 0 && (
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Unfinished items</Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Leave them here as not done — pick them up later from the backlog</SelectItem>
                {targets.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    Copy into {t.name} ({t.startDate} → {t.endDate}) — they stay here too, as spillover
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={submitting} onClick={handleComplete}>
            {submitting ? "Completing…" : "Complete sprint"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
