"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  RiRefreshLine,
  RiInboxLine,
  RiDeleteBin6Line,
} from "@remixicon/react";
import { DelayLogButton } from "@/components/delay-tracker/delay-log-button";
import { DeliveryBadge } from "@/components/delivery-tracker/delivery-badge";

type ActiveIssue = {
  jiraIssueId: string;
  jiraKey: string;
  summary: string;
  status: string;
  statusCategory: string | null;
  priority: string | null;
  projectName: string;
  jiraBaseUrl: string;
};

type PulseMember = {
  memberId: string;
  name: string;
  email: string;
  loadScore: number;
  loadLabel: "Free" | "Light" | "Moderate" | "Heavy";
  activeIssues: ActiveIssue[];
  stalledCount: number;
};

type Props = {
  boardId: string;
  onRemoveMember?: (email: string) => void;
};

export function TeamPulseClient({ boardId, onRemoveMember }: Props) {
  const [members, setMembers] = useState<PulseMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/observer/boards/${boardId}/pulse`);
      if (res.ok) {
        setMembers(await res.json());
        setLastRefreshed(new Date());
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Server error (${res.status})`);
      }
    } catch {
      setError("Failed to load pulse data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [boardId]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 bg-zinc-100 dark:bg-zinc-800/50 rounded" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <button onClick={load} className="mt-2 text-xs text-muted-foreground hover:text-foreground underline">
          Try again
        </button>
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="py-12 text-center">
        <RiInboxLine size={24} className="text-zinc-300 dark:text-zinc-700 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No members on this board yet.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-muted-foreground">
          {lastRefreshed && `Updated ${lastRefreshed.toLocaleTimeString()}`}
        </p>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RiRefreshLine size={12} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="space-y-4">
        {members.map((member) => (
          <MemberRow
            key={member.memberId}
            member={member}
            onRemove={onRemoveMember ? () => onRemoveMember(member.email) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function MemberRow({ member, onRemove }: { member: PulseMember; onRemove?: () => void }) {
  const { loadLabel, stalledCount } = member;

  const loadColor = {
    Free:     "text-emerald-600 dark:text-emerald-400",
    Light:    "text-emerald-600 dark:text-emerald-400",
    Moderate: "text-amber-600 dark:text-amber-400",
    Heavy:    "text-red-600 dark:text-red-400",
  }[loadLabel];

  return (
    <div className="p-5 rounded-xl border border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/50 shadow-sm">
      {/* Member header */}
      <div className="flex items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="size-8 rounded-full bg-gradient-to-br from-zinc-100 to-zinc-50 dark:from-zinc-800 dark:to-zinc-900 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-[11px] font-bold text-zinc-500 shrink-0">
            {member.name.split(" ").map(n => n[0]).join("").toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-bold text-zinc-900 dark:text-zinc-50 truncate">
                {member.name}
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-zinc-50 dark:bg-zinc-800/50 ${loadColor}`}>
                {loadLabel}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground truncate">
              <span>{member.email}</span>
              {stalledCount > 0 && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-800">·</span>
                  <span className="font-medium text-amber-600 dark:text-amber-400">{stalledCount} stalled</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <Link
            href={`/observer/developer/${encodeURIComponent(member.email)}`}
            prefetch={false}
            className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
          >
            Full profile →
          </Link>
          {onRemove && (
            <button
              onClick={onRemove}
              className="text-zinc-300 dark:text-zinc-600 hover:text-destructive transition-colors"
              title="Remove from board"
            >
              <RiDeleteBin6Line size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Active issues */}
      {member.activeIssues.length === 0 ? (
        <div className="bg-zinc-50/50 dark:bg-zinc-800/20 rounded-lg py-3 px-4 border border-dashed border-zinc-200 dark:border-zinc-800">
          <p className="text-xs text-muted-foreground italic">No in-progress issues</p>
        </div>
      ) : (
        <div className="space-y-1">
          {member.activeIssues.map((issue) => (
            <IssueRow key={issue.jiraIssueId} issue={issue} />
          ))}
        </div>
      )}
    </div>
  );
}

function IssueRow({ issue }: { issue: ActiveIssue }) {
  const jiraUrl = `${issue.jiraBaseUrl.replace(/\/$/, "")}/browse/${issue.jiraKey}`;

  return (
    <div className="py-2 px-3 -mx-3 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors">
      <div className="flex items-start gap-3 min-w-0">
        <span
          className="shrink-0 mt-2 size-1.5 rounded-full"
          style={{ background: statusColor(issue.statusCategory) }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 leading-tight">
              {issue.summary}
            </span>
            <StatusChip status={issue.status} statusCategory={issue.statusCategory} />
          </div>
          <div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground/80 font-medium">
            <a
              href={jiraUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono hover:text-primary transition-colors"
            >
              {issue.jiraKey}
            </a>
            <span className="text-zinc-300 dark:text-zinc-800">·</span>
            <span className="truncate max-w-[200px]">{issue.projectName}</span>
            {issue.priority && (
              <>
                <span className="text-zinc-300 dark:text-zinc-800">·</span>
                <span className={priorityColor(issue.priority)}>{issue.priority}</span>
              </>
            )}
            <DelayLogButton issueId={issue.jiraIssueId} />
            <DeliveryBadge issueId={issue.jiraIssueId} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusChip({ status, statusCategory }: { status: string; statusCategory: string | null }) {
  const cat = (statusCategory ?? "").toLowerCase();
  const cls =
    cat.includes("done") || cat.includes("complete")
      ? "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100/50 dark:border-emerald-900/50"
      : cat.includes("progress") || cat === "indeterminate"
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
    case "highest": return "text-red-600 dark:text-red-400 font-semibold";
    case "high":    return "text-orange-600 dark:text-orange-400 font-semibold";
    case "medium":  return "text-amber-600 dark:text-amber-400 font-semibold";
    default:        return "";
  }
}
