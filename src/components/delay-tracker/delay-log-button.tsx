"use client";

import { useState } from "react";
import { RiAlarmWarningLine, RiExternalLinkLine, RiDeleteBinLine, RiPencilLine, RiCloseLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DelayTrackerIssueDetail, DelayLogEntry } from "@/app/api/delay-tracker/issue/[issueId]/route";
import { DELAY_CATEGORIES, OTHER_PROJECT_CATEGORIES, categoryLabel, categoryColor, type DelayCategoryValue } from "./categories";
import { DelayHistoryDonut } from "./delay-history-donut";
import { AddDelayForm } from "./add-delay-form";
import { PersonPicker } from "./person-picker";
import { LinkedIssuePicker, type LinkedIssue } from "./linked-issue-picker";

/**
 * The single reusable entry point dropped into every issue-list surface. No
 * data is fetched until the popup is actually opened — a row with this
 * button costs nothing beyond rendering an icon.
 */
export function DelayLogButton({ issueId }: { issueId: string }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<DelayTrackerIssueDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch is triggered from the open-change event, not an effect — nothing
  // runs until the user actually opens the popup for this issue, and there's
  // no risk of cascading synchronous re-renders from setState-in-effect.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setLoading(true);
    setError(null);
    fetch(`/api/delay-tracker/issue/${issueId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: DelayTrackerIssueDetail) => setDetail(d))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  function handleCreated(entry: DelayLogEntry) {
    setDetail((prev) => (prev ? { ...prev, history: [entry, ...prev.history] } : prev));
  }
  function handleUpdated(entry: DelayLogEntry) {
    setDetail((prev) =>
      prev ? { ...prev, history: prev.history.map((h) => (h.id === entry.id ? entry : h)) } : prev
    );
  }
  function handleDeleted(id: string) {
    setDetail((prev) => (prev ? { ...prev, history: prev.history.filter((h) => h.id !== id) } : prev));
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/*
        Not a DialogTrigger: Radix's composeEventHandlers skips its own
        open-toggle handler once the caller's onClick calls preventDefault(),
        which we need here so rows that wrap this button in an <a> or another
        clickable container (Jira deep-links, expandable cards) don't
        navigate/toggle when the delay popup opens. So we drive `open`
        directly instead — and replicate the aria/data attributes
        DialogTrigger would otherwise have set, so screen readers still get
        "this button opens a dialog" + its current open/closed state.
      */}
      <Button
        variant="ghost"
        size="icon-sm"
        title="View / log delays"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-state={open ? "open" : "closed"}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleOpenChange(true);
        }}
      >
        <RiAlarmWarningLine className="size-3.5" />
      </Button>
      <DialogContent className="max-w-lg sm:max-w-lg" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Delay tracker</DialogTitle>
          <DialogDescription>Jira details and delay history for this issue.</DialogDescription>
        </DialogHeader>

        {/*
          Mutually exclusive, and stale detail from a prior open is kept
          on screen (not cleared) while a reopen silently refetches in the
          background — the skeleton only shows on a genuine first load, so
          re-opening an already-viewed issue never flashes/resizes.
        */}
        {loading && !detail && <DelayTrackerSkeleton />}
        {error && !detail && <p className="text-xs text-destructive">Failed to load: {error}</p>}

        {detail && (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            <div className="rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <a
                  href={`${detail.issue.jiraBaseUrl.replace(/\/$/, "")}/browse/${detail.issue.jiraKey}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-foreground hover:underline"
                >
                  {detail.issue.jiraKey}
                  <RiExternalLinkLine className="size-3 opacity-60" />
                </a>
                <span className="text-[11px] text-muted-foreground">{detail.issue.projectName}</span>
              </div>
              <p className="mt-1 text-sm font-medium text-foreground">{detail.issue.summary}</p>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{detail.issue.status}</span>
                {detail.issue.priority && <span>· {detail.issue.priority}</span>}
                <span>· {detail.issue.issueType}</span>
              </div>
            </div>

            <DelayHistoryDonut history={detail.history} />

            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                Delay history ({detail.history.length})
              </p>
              {detail.history.length === 0 ? (
                <p className="text-xs text-muted-foreground">No delays logged yet.</p>
              ) : (
                <div className="space-y-2">
                  {detail.history.map((entry) => (
                    <HistoryRow key={entry.id} entry={entry} onUpdated={handleUpdated} onDeleted={handleDeleted} />
                  ))}
                </div>
              )}
            </div>

            <AddDelayForm
              issueId={issueId}
              defaultResponsible={detail.defaultResponsible}
              onCreated={handleCreated}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Mirrors the loaded layout's approximate proportions (Jira card, history
// list, add-form) so the dialog doesn't visibly jump in height once the
// fetch resolves — a plain "Loading…" line was far shorter than the real
// content, causing the popup to snap taller a moment after opening.
function DelayTrackerSkeleton() {
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
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
      <Skeleton className="h-56 w-full rounded-lg" />
    </div>
  );
}

function HistoryRow({
  entry,
  onUpdated,
  onDeleted,
}: {
  entry: DelayLogEntry;
  onUpdated: (entry: DelayLogEntry) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState<DelayCategoryValue>(entry.category as DelayCategoryValue);
  const [delayDate, setDelayDate] = useState(entry.delayDate);
  const [responsible, setResponsible] = useState(
    entry.responsibleEmail ? { email: entry.responsibleEmail, name: entry.responsibleName ?? entry.responsibleEmail } : null
  );
  const [linked, setLinked] = useState<LinkedIssue | null>(
    entry.linkedIssueId && entry.linkedProjectId
      ? {
          projectId: entry.linkedProjectId,
          issueId: entry.linkedIssueId,
          jiraKey: entry.linkedJiraKey ?? "",
          summary: entry.linkedSummary ?? "",
        }
      : null
  );
  const [note, setNote] = useState(entry.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsLink = OTHER_PROJECT_CATEGORIES.has(category);
  const canSave = !!category && !!delayDate && (!needsLink || !!linked) && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/delay-tracker/logs/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          delayDate,
          responsibleEmail: responsible?.email ?? null,
          responsibleName: responsible?.name ?? null,
          note: note.trim() || null,
          linkedProjectId: needsLink ? linked?.projectId ?? null : null,
          linkedIssueId: needsLink ? linked?.issueId ?? null : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { log } = await res.json();
      onUpdated(log as DelayLogEntry);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Remove this delay entry?")) return;
    const res = await fetch(`/api/delay-tracker/logs/${entry.id}`, { method: "DELETE" });
    if (res.ok) onDeleted(entry.id);
  }

  if (editing) {
    return (
      <div className="space-y-2 rounded-lg border border-border/60 p-3">
        <div className="grid grid-cols-2 gap-2">
          <Select value={category} onValueChange={(v) => setCategory(v as DelayCategoryValue)}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DELAY_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={delayDate}
            onChange={(e) => setDelayDate(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <PersonPicker value={responsible} onChange={setResponsible} />
        {needsLink && <LinkedIssuePicker value={linked} onChange={setLinked} />}
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-14 text-xs" />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={!canSave} className="flex-1">
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
            <RiCloseLine className="size-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold border-transparent"
            style={{ background: `color-mix(in srgb, ${categoryColor(entry.category)} 18%, transparent)`, color: categoryColor(entry.category) }}
          >
            {categoryLabel(entry.category)}
          </Badge>
          <span className="text-[11px] text-muted-foreground">{entry.delayDate}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => setEditing(true)} title="Edit">
            <RiPencilLine className="size-3" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={handleDelete} title="Delete">
            <RiDeleteBinLine className="size-3" />
          </Button>
        </div>
      </div>
      {entry.responsibleName && (
        <p className="mt-1 text-xs text-foreground">
          Responsible: <span className="font-medium">{entry.responsibleName}</span>
        </p>
      )}
      {entry.linkedJiraKey && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          Linked: <span className="font-mono">{entry.linkedJiraKey}</span> — {entry.linkedSummary}
        </p>
      )}
      {entry.note && <p className="mt-1 text-xs text-muted-foreground">{entry.note}</p>}
      <p className="mt-1 text-[10px] text-muted-foreground/70">Logged by {entry.loggedByName ?? entry.loggedBy}</p>
    </div>
  );
}
