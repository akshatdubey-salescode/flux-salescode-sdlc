"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import {
  RiCheckboxCircleLine,
  RiAddLine,
  RiDeleteBinLine,
  RiEditLine,
  RiCheckLine,
  RiCloseLine,
  RiInboxLine,
  RiTimeLine,
  RiAlertLine,
  RiCalendarLine,
} from "@remixicon/react";
import { MyTasksView } from "@/components/my-tasks";
import { TrackingIssue } from "@/components/my-tasks/helpers";

type ActiveDeclaration = {
  id: string;
  comment: string | null;
  expected_completion_date: string | null;
  created_at: string;
  updated_at: string;
  jira_issue_id: string;
  jira_key: string;
  summary: string;
  status: string;
  status_category: string | null;
  priority: string | null;
  project_name: string;
  project_key: string;
};

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

export function CheckInClient() {
  const [active, setActive] = useState<ActiveDeclaration[]>([]);
  const [loading, setLoading] = useState(true);
  const [declaringId, setDeclaringId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const todayLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  async function loadActive() {
    setLoading(true);
    try {
      const res = await fetch("/api/observer/declarations");
      if (res.ok) setActive(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadActive(); }, []);

  async function declare(issue: TrackingIssue) {
    setDeclaringId(issue.id);
    try {
      const res = await fetch("/api/observer/declarations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jiraIssueId: issue.id,
          expectedCompletionDate: todayStr(), // Default to today
        }),
      });
      if (res.ok) {
        await loadActive();
      }
    } finally {
      setDeclaringId(null);
    }
  }

  async function remove(decl: ActiveDeclaration) {
    setRemovingId(decl.id);
    try {
      const res = await fetch(`/api/observer/declarations/${decl.id}`, { method: "DELETE" });
      if (res.ok || res.status === 204) {
        setActive((prev) => prev.filter((d) => d.id !== decl.id));
      }
    } finally {
      setRemovingId(null);
    }
  }

  async function updateDeclaration(
    decl: ActiveDeclaration,
    patch: { comment?: string | null; expectedCompletionDate?: string | null }
  ) {
    const res = await fetch(`/api/observer/declarations/${decl.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const updated = await res.json();
      setActive((prev) =>
        prev.map((d) =>
          d.id === decl.id
            ? {
                ...d,
                comment: updated.comment ?? d.comment,
                expected_completion_date:
                  updated.expectedCompletionDate ?? d.expected_completion_date,
                updated_at: updated.updatedAt ?? d.updated_at,
              }
            : d
        )
      );
    }
  }

  if (loading && active.length === 0) {
    return (
      <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
        <div className="h-10 w-64 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-48 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-96 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      </div>
    );
  }

  const activeIssueIds = new Set(active.map(a => a.jira_issue_id));

  return (
    <div className="max-w-5xl mx-auto space-y-10">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Check-in
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 flex items-center gap-1.5">
            <RiTimeLine size={14} className="text-zinc-400" />
            <span className="font-medium text-zinc-600 dark:text-zinc-300">{todayLabel}</span>
          </p>
        </div>
      </div>

      {/* Active section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 px-1">
          <RiCheckboxCircleLine size={18} className="text-emerald-500" />
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
            Active today
          </h2>
          {active.length > 0 && (
            <span className="ml-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 rounded-full px-2 py-0.5 border border-emerald-100 dark:border-emerald-900/50">
              {active.length}
            </span>
          )}
        </div>

        <div className="grid gap-4">
          {active.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/20">
              <RiInboxLine size={32} className="text-zinc-300 dark:text-zinc-700 mb-3" />
              <p className="text-sm font-medium text-zinc-500">No declarations yet today.</p>
              <p className="text-xs text-muted-foreground mt-1">Pick JIRAs from your queue below to start your day.</p>
            </div>
          ) : (
            active.map((decl) => (
              <DeclarationCard
                key={decl.id}
                decl={decl}
                onRemove={() => remove(decl)}
                onSaveComment={(comment) => updateDeclaration(decl, { comment })}
                onSaveExpectedDate={(date) =>
                  updateDeclaration(decl, { expectedCompletionDate: date })
                }
                removing={removingId === decl.id}
              />
            ))
          )}
        </div>
      </div>

      {/* Pending queue */}
      <div className="space-y-4 pt-4 border-t border-zinc-100 dark:border-zinc-800/60">
        <div className="flex items-center gap-2 px-1">
          <RiInboxLine size={18} className="text-blue-500" />
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
            Your open queue
          </h2>
        </div>

        <Suspense fallback={<div className="h-96 rounded-xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" />}>
          <MyTasksView 
            hideTabs
            renderIssueActions={(issue) => {
              const isAdded = activeIssueIds.has(issue.id);
              return (
                <button
                  onClick={() => declare(issue)}
                  disabled={declaringId === issue.id || isAdded}
                  className={`p-1.5 rounded-lg transition-all ${
                    isAdded 
                      ? "text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 cursor-default"
                      : "text-primary hover:bg-primary/10 bg-primary/5 active:scale-90"
                  }`}
                  title={isAdded ? "Already added" : "Add to active today"}
                >
                  {isAdded ? <RiCheckLine size={16} /> : <RiAddLine size={16} />}
                </button>
              );
            }}
          />
        </Suspense>
      </div>
    </div>
  );
}

function DeclarationCard({
  decl,
  onRemove,
  onSaveComment,
  onSaveExpectedDate,
  removing,
}: {
  decl: ActiveDeclaration;
  onRemove: () => void;
  onSaveComment: (comment: string | null) => void;
  onSaveExpectedDate: (date: string) => void;
  removing: boolean;
}) {
  const [editingComment, setEditingComment] = useState(false);
  const [commentDraft, setCommentDraft] = useState(decl.comment ?? "");
  const [editingDate, setEditingDate] = useState(false);
  const [dateDraft, setDateDraft] = useState(
    decl.expected_completion_date ?? todayStr()
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editingComment) inputRef.current?.focus();
  }, [editingComment]);

  function startEditComment() {
    setCommentDraft(decl.comment ?? "");
    setEditingComment(true);
  }

  function saveComment() {
    const trimmed = commentDraft.trim() || null;
    onSaveComment(trimmed);
    setEditingComment(false);
  }

  function cancelEditComment() {
    setCommentDraft(decl.comment ?? "");
    setEditingComment(false);
  }

  function saveDate() {
    onSaveExpectedDate(dateDraft);
    setEditingDate(false);
  }

  const displayDate = decl.expected_completion_date;
  const today = todayStr();
  const isOverdue = displayDate && displayDate < today;
  const isToday = displayDate === today;

  return (
    <div className={`p-5 rounded-xl border border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/50 shadow-sm transition-opacity ${removing ? "opacity-40" : ""}`}>
      <div className="flex items-start gap-4">
        <span
          className="mt-2 shrink-0 inline-block size-2 rounded-full"
          style={{ background: statusColor(decl.status_category) }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <p className="text-[15px] font-bold text-zinc-900 dark:text-zinc-50 leading-tight">
              {decl.summary}
            </p>
            <div className="shrink-0 flex items-center gap-2">
              <StatusChip status={decl.status} statusCategory={decl.status_category} />
              <button
                onClick={onRemove}
                disabled={removing}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8 transition-colors disabled:opacity-40"
                title="Remove declaration"
              >
                <RiDeleteBinLine size={15} />
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground font-medium">
            <span className="font-mono text-zinc-500">{decl.jira_key}</span>
            <span className="text-zinc-300 dark:text-zinc-800">·</span>
            <span>{decl.project_name}</span>
            {decl.priority && (
              <>
                <span className="text-zinc-300 dark:text-zinc-800">·</span>
                <span className={priorityColor(decl.priority)}>{decl.priority}</span>
              </>
            )}
            <span className="text-zinc-300 dark:text-zinc-800">·</span>
            <span>declared {formatTime(decl.created_at)}</span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {/* Expected completion */}
            {editingDate ? (
              <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-800 p-1 rounded-lg border border-zinc-200 dark:border-zinc-700">
                <input
                  type="date"
                  value={dateDraft}
                  min={today}
                  onChange={(e) => setDateDraft(e.target.value)}
                  className="text-xs bg-transparent text-zinc-800 dark:text-zinc-200 outline-none px-1"
                />
                <button
                  onClick={saveDate}
                  className="p-1 rounded bg-primary text-white hover:bg-primary/90"
                >
                  <RiCheckLine size={12} />
                </button>
                <button
                  onClick={() => setEditingDate(false)}
                  className="p-1 rounded text-muted-foreground hover:bg-zinc-200 dark:hover:bg-zinc-700"
                >
                  <RiCloseLine size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setDateDraft(displayDate ?? today); setEditingDate(true); }}
                className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider rounded-lg px-2.5 py-1.5 border transition-all ${
                  isOverdue
                    ? "text-red-600 border-red-200 bg-red-50 hover:bg-red-100"
                    : isToday
                      ? "text-amber-600 border-amber-200 bg-amber-50 hover:bg-amber-100"
                      : "text-zinc-500 border-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
                }`}
              >
                <RiCalendarLine size={12} />
                {displayDate ? `Exp. ${formatDateShort(displayDate)}` : "Set expected date"}
              </button>
            )}

            {/* Note toggle */}
            {!editingComment && !decl.comment && (
              <button
                onClick={startEditComment}
                className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary bg-primary/5 hover:bg-primary/10 px-2.5 py-1.5 rounded-lg border border-primary/10 transition-all"
              >
                <RiEditLine size={12} />
                Add Note
              </button>
            )}
          </div>

          {/* Comment area */}
          {editingComment ? (
            <div className="mt-4 space-y-2">
              <textarea
                ref={inputRef}
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                placeholder="Add a note for your manager… e.g. waiting on backend team"
                rows={2}
                className="w-full text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-zinc-800 dark:text-zinc-200 placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={saveComment}
                  className="flex items-center gap-1.5 text-xs font-bold text-white bg-zinc-900 dark:bg-zinc-50 dark:text-zinc-900 rounded-lg px-3 py-1.5 hover:opacity-90 transition-opacity"
                >
                  <RiCheckLine size={14} />
                  Save Note
                </button>
                <button
                  onClick={cancelEditComment}
                  className="text-xs font-bold text-muted-foreground hover:text-foreground px-2 py-1.5 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : decl.comment ? (
            <button
              onClick={startEditComment}
              className="mt-4 w-full text-left group"
            >
              <div className="flex items-start gap-2 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30 px-4 py-3 transition-colors hover:bg-amber-50 dark:hover:bg-amber-950/30">
                <RiAlertLine size={14} className="text-amber-500 mt-0.5 shrink-0" />
                <span className="text-sm text-amber-900 dark:text-amber-400 font-medium flex-1">
                  {decl.comment}
                </span>
                <RiEditLine size={14} className="text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
              </div>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StatusChip({ status, statusCategory }: { status: string; statusCategory: string | null }) {
  const cat = (statusCategory ?? "").toLowerCase();
  const cls =
    cat === "done" || cat === "complete" || cat === "completed"
      ? "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100/50 dark:border-emerald-900/50"
      : cat === "in progress" || cat === "indeterminate"
        ? "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-100/50 dark:border-amber-900/50"
        : "text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 border-zinc-200/50 dark:border-zinc-700/50";
  return (
    <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-tight uppercase whitespace-nowrap ${cls}`}>
      {status}
    </span>
  );
}

function statusColor(cat: string | null): string {
  const c = (cat ?? "").toLowerCase();
  if (c === "done" || c === "complete" || c === "completed") return "#10b981";
  if (c === "in progress" || c === "indeterminate") return "#f59e0b";
  return "#94a3b8";
}

function priorityColor(priority: string): string {
  switch (priority?.toLowerCase()) {
    case "critical":
    case "highest":
      return "text-red-600 dark:text-red-400 font-bold";
    case "high":
      return "text-orange-600 dark:text-orange-400 font-bold";
    case "medium":
      return "text-amber-600 dark:text-amber-400 font-bold";
    default:
      return "text-muted-foreground";
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "";
  }
}

function formatDateShort(dateStr: string) {
  try {
    const d = new Date(dateStr + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
    if (diff === 0) return "today";
    if (diff === 1) return "tomorrow";
    if (diff === -1) return "yesterday";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}
