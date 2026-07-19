"use client";

import { useEffect, useState } from "react";
import {
  RiExternalLinkLine,
  RiDeleteBinLine,
  RiDeleteBin2Line,
  RiPencilLine,
  RiCloseLine,
  RiArrowDownSLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { DelayTrackerIssueDetail, DelayLogEntry } from "@/app/api/delay-tracker/issue/[issueId]/route";
import {
  DELAY_CATEGORIES,
  OTHER_PROJECT_CATEGORIES,
  PERSON_REQUIRED_CATEGORIES,
  categoryLabel,
  categoryColor,
  type DelayCategoryValue,
} from "@/lib/delay-tracker/categories";
import { DelayHistoryDonut } from "./delay-history-donut";
import { AddDelayForm } from "./add-delay-form";
import { PersonPicker } from "./person-picker";
import { LinkedIssuePicker, type LinkedIssue } from "./linked-issue-picker";
import { patchDelaySummary } from "./delay-summary-cache";

/**
 * Jira details + delay history (active and deleted) + add/edit/delete form
 * for one issue — the content shared by `DelayLogButton`'s inline popup and
 * the standalone `/delay-tracker/issue/[issueId]` page, so both stay in
 * lockstep instead of maintaining two copies of the same fetch/render/edit
 * logic.
 */
export function DelayTrackerPanel({
  issueId,
  onEntriesChanged,
}: {
  issueId: string;
  /** Fired after a create/update/delete, so a caller with its own derived view (e.g. a filtered issue table) can refetch/reconcile. */
  onEntriesChanged?: () => void;
}) {
  const [detail, setDetail] = useState<DelayTrackerIssueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);

  // No synchronous setState at the top of the effect (`detail`/`error` both
  // start `null` on mount and only ever change from inside the async
  // .then/.catch below) — "still loading" is simply derived as `!detail &&
  // !error`, so there's no cascading-render reset to guard against.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/delay-tracker/issue/${issueId}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: DelayTrackerIssueDetail) => {
        setDetail(d);
        // Reconcile the icon/tooltip with the just-loaded authoritative
        // history, in case the batched summary was stale or never resolved.
        patchDelaySummary(issueId, d.history, d.deletedHistory);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => controller.abort();
  }, [issueId]);

  // Each handler computes the new history off the current `detail` closure
  // (fresh every render, since HistoryRow/AddDelayForm are handed a new
  // callback each time) rather than inside the setDetail updater, so
  // patchDelaySummary — a side effect — never risks running twice under
  // React's dev-mode double-invocation of updater functions.
  function handleCreated(entry: DelayLogEntry) {
    if (!detail) return;
    const history = sortHistory([entry, ...detail.history]);
    setDetail({ ...detail, history });
    patchDelaySummary(issueId, history, detail.deletedHistory);
    onEntriesChanged?.();
  }
  function handleUpdated(entry: DelayLogEntry) {
    if (!detail) return;
    const history = sortHistory(
      detail.history.map((historyEntry) => (historyEntry.id === entry.id ? entry : historyEntry))
    );
    setDetail({ ...detail, history });
    patchDelaySummary(issueId, history, detail.deletedHistory);
    onEntriesChanged?.();
  }
  // Deleting is a deactivation, not a removal — the entry moves from the
  // active list into deletedHistory (returned by the DELETE response fully
  // joined) instead of disappearing, so its creator/deleter audit trail
  // stays visible in the panel.
  function handleDeleted(deletedEntry: DelayLogEntry) {
    if (!detail) return;
    const history = detail.history.filter((h) => h.id !== deletedEntry.id);
    const deletedHistory = sortHistory([deletedEntry, ...detail.deletedHistory]);
    setDetail({ ...detail, history, deletedHistory });
    patchDelaySummary(issueId, history, deletedHistory);
    onEntriesChanged?.();
  }

  return (
    <div>
      {/*
        Mutually exclusive: the skeleton only shows on a genuine first load;
        an error keeps whatever detail (if any) is already on screen.
      */}
      {!detail && !error && <DelayTrackerSkeleton />}
      {error && !detail && <p className="text-xs text-destructive">Failed to load: {error}</p>}
      {error && detail && <p className="text-xs text-destructive">Refresh failed: {error}</p>}

      {detail && (
        <div className="space-y-4">
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
                  <HistoryRow
                    key={entry.id}
                    entry={entry}
                    projectId={detail.issue.projectId}
                    onUpdated={handleUpdated}
                    onDeleted={handleDeleted}
                  />
                ))}
              </div>
            )}
          </div>

          {detail.deletedHistory.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowDeleted((v) => !v)}
                className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 hover:text-foreground"
              >
                <RiDeleteBin2Line className="size-3" />
                Deleted delays ({detail.deletedHistory.length})
                <RiArrowDownSLine
                  className={cn("size-3 transition-transform", showDeleted && "rotate-180")}
                />
              </button>
              {showDeleted && (
                <div className="space-y-2">
                  {detail.deletedHistory.map((entry) => (
                    <DeletedHistoryRow key={entry.id} entry={entry} />
                  ))}
                </div>
              )}
            </div>
          )}

          <AddDelayForm
            issueId={issueId}
            projectId={detail.issue.projectId}
            defaultResponsible={detail.defaultResponsible}
            onCreated={handleCreated}
          />
        </div>
      )}
    </div>
  );
}

// Mirrors the loaded layout's approximate proportions (Jira card, history
// list, add-form) so the panel doesn't visibly jump in height once the
// fetch resolves — a plain "Loading…" line was far shorter than the real
// content, causing a visible snap a moment after mount.
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
  projectId,
  onUpdated,
  onDeleted,
}: {
  entry: DelayLogEntry;
  projectId: string;
  onUpdated: (entry: DelayLogEntry) => void;
  onDeleted: (entry: DelayLogEntry) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [category, setCategory] = useState<DelayCategoryValue>(entry.category as DelayCategoryValue);
  const [delayDate, setDelayDate] = useState(entry.delayDate);
  const [responsible, setResponsible] = useState(() => responsibleFromEntry(entry));
  const [linked, setLinked] = useState<LinkedIssue | null>(() => linkedIssueFromEntry(entry));
  const [note, setNote] = useState(entry.note ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsLink = OTHER_PROJECT_CATEGORIES.has(category);
  const needsResponsible = PERSON_REQUIRED_CATEGORIES.has(category);
  const canSave =
    !!category && !!delayDate && (!needsLink || !!linked) && (!needsResponsible || !!responsible) && !saving && !deleting;

  function resetDraft(source: DelayLogEntry = entry) {
    setCategory(source.category as DelayCategoryValue);
    setDelayDate(source.delayDate);
    setResponsible(responsibleFromEntry(source));
    setLinked(linkedIssueFromEntry(source));
    setNote(source.note ?? "");
    setError(null);
  }

  function beginEditing() {
    resetDraft();
    setEditing(true);
  }

  function cancelEditing() {
    resetDraft();
    setEditing(false);
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/delay-tracker/logs/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: entry.updatedAt,
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
      const { log } = (await res.json()) as { log: DelayLogEntry };
      resetDraft(log);
      onUpdated(log);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/delay-tracker/logs/${entry.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { log } = (await res.json()) as { log: DelayLogEntry | null };
      onDeleted(log ?? entry);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
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
        <PersonPicker value={responsible} onChange={setResponsible} allowClear />
        {needsResponsible && !responsible && (
          <p className="text-[11px] text-destructive">A responsible person is required for this reason.</p>
        )}
        {needsLink && (
          <LinkedIssuePicker
            value={linked}
            onChange={setLinked}
            excludedProjectId={projectId}
          />
        )}
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-14 text-xs" />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={!canSave} className="flex-1">
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" variant="outline" onClick={cancelEditing} disabled={saving}>
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
          <Button variant="ghost" size="icon-sm" onClick={beginEditing} title="Edit" disabled={deleting}>
            <RiPencilLine className="size-3" />
          </Button>
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Delete"
              disabled={deleting}
              onClick={() => setConfirmOpen(true)}
            >
              <RiDeleteBinLine className="size-3" />
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove this delay entry?</AlertDialogTitle>
                <AlertDialogDescription>
                  It&rsquo;s kept for audit purposes and stops counting toward this
                  issue&rsquo;s delay history. It can&rsquo;t be restored from here.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleDelete}>
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      <p className="mt-1 text-[10px] text-muted-foreground/70">Logged by {entry.loggedByName ?? entry.loggedBy}</p>
    </div>
  );
}

// Read-only — a deleted entry has nothing left to edit or delete, just the
// same category/date/responsible/note facts plus who logged it and who
// deactivated it, both with a timestamp.
function DeletedHistoryRow({ entry }: { entry: DelayLogEntry }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5">
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold border-transparent opacity-70"
          style={{ background: `color-mix(in srgb, ${categoryColor(entry.category)} 18%, transparent)`, color: categoryColor(entry.category) }}
        >
          {categoryLabel(entry.category)}
        </Badge>
        <span className="text-[11px] text-muted-foreground">{entry.delayDate}</span>
      </div>
      {entry.responsibleName && (
        <p className="mt-1 text-xs text-muted-foreground">
          Responsible: <span className="font-medium">{entry.responsibleName}</span>
        </p>
      )}
      {entry.note && <p className="mt-1 text-xs text-muted-foreground">{entry.note}</p>}
      <p className="mt-1.5 text-[10px] text-muted-foreground/70">
        Logged by {entry.loggedByName ?? entry.loggedBy} on {formatDateTime(entry.createdAt)}
      </p>
      <p className="text-[10px] text-muted-foreground/70">
        Deleted by {entry.deletedByName ?? entry.deletedBy ?? "unknown"}
        {entry.deletedAt ? ` on ${formatDateTime(entry.deletedAt)}` : ""}
      </p>
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function responsibleFromEntry(entry: DelayLogEntry) {
  return entry.responsibleEmail
    ? {
        email: entry.responsibleEmail,
        name: entry.responsibleName ?? entry.responsibleEmail,
      }
    : null;
}

function linkedIssueFromEntry(entry: DelayLogEntry): LinkedIssue | null {
  return entry.linkedIssueId && entry.linkedProjectId
    ? {
        projectId: entry.linkedProjectId,
        issueId: entry.linkedIssueId,
        jiraKey: entry.linkedJiraKey ?? "",
        summary: entry.linkedSummary ?? "",
      }
    : null;
}

function sortHistory(history: DelayLogEntry[]): DelayLogEntry[] {
  return history.sort(
    (a, b) =>
      b.delayDate.localeCompare(a.delayDate) || b.createdAt.localeCompare(a.createdAt)
  );
}
