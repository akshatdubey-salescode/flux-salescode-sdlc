"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { DelayLogButton } from "@/components/delay-tracker/delay-log-button";
import {
  TrackingIssue,
  FilterState,
  statusCategoryStyles,
  priorityStyles,
  issueTypeStyles,
  initials,
  formatRelativeTime,
} from "./helpers";

const BOARD_PAGE_SIZE = 25;

type Column = { status: string; statusCategory: string | null };

type Props = {
  projectId: string;
  columns: Column[];
  filters: FilterState;
  boardFilterKey: string;
};

export function BoardViewSkeleton() {
  return (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-6 px-6">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900/60"
        >
          <div className="mb-1 h-3 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
          {[1, 2, 3, 4].map((j) => (
            <div
              key={j}
              className="h-24 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function BoardView({ projectId, columns, filters, boardFilterKey }: Props) {
  if (columns.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-200 p-16 text-center dark:border-zinc-800">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          No issues found
        </p>
        <p className="mt-1 text-xs text-zinc-400">Try adjusting your filters.</p>
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-6 px-6">
      {columns.map((col) => (
        <BoardColumn
          key={col.status}
          projectId={projectId}
          status={col.status}
          statusCategory={col.statusCategory}
          filters={filters}
          boardFilterKey={boardFilterKey}
        />
      ))}
    </div>
  );
}

function buildColumnUrl(
  projectId: string,
  status: string,
  filters: FilterState,
  page: number
): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.priority.length) params.set("priority", filters.priority.join(","));
  if (filters.assignee.length) params.set("assignee", filters.assignee.join(","));
  if (filters.reporter.length) params.set("reporter", filters.reporter.join(","));
  if (filters.issueType.length) params.set("issueType", filters.issueType.join(","));
  if (filters.labels.length) params.set("labels", filters.labels.join(","));
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  params.set("sortBy", filters.sortBy);
  params.set("sortDir", filters.sortDir);
  params.set("status", status);
  params.set("pageSize", String(BOARD_PAGE_SIZE));
  params.set("page", String(page));
  return `/api/projects/${projectId}/issues?${params.toString()}`;
}

function BoardColumn({
  projectId,
  status,
  statusCategory,
  filters,
  boardFilterKey,
}: {
  projectId: string;
  status: string;
  statusCategory: string | null;
  filters: FilterState;
  boardFilterKey: string;
}) {
  const [issues, setIssues] = useState<TrackingIssue[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setIssues([]);
    setPage(1);
    fetch(buildColumnUrl(projectId, status, filters, 1))
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setIssues(data.issues ?? []);
        setTotal(data.total ?? 0);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // boardFilterKey encodes all filter fields that affect per-column queries
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, status, boardFilterKey]);

  function handleLoadMore() {
    const nextPage = page + 1;
    setLoadingMore(true);
    fetch(buildColumnUrl(projectId, status, filters, nextPage))
      .then((r) => r.json())
      .then((data) => {
        setIssues((prev) => [...prev, ...(data.issues ?? [])]);
        setPage(nextPage);
        setLoadingMore(false);
      })
      .catch(() => setLoadingMore(false));
  }

  const styles = statusCategoryStyles(statusCategory);
  const hasMore = issues.length < total;

  return (
    <div
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-xl border-l-[3px] bg-zinc-50 dark:bg-zinc-900/60",
        styles.border
      )}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 truncate flex-1">
          {status}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-px text-[10px] font-semibold leading-none",
            styles.badge
          )}
        >
          {loading ? "…" : total}
        </span>
      </div>

      {/* Cards */}
      <div
        className="flex flex-col gap-2 overflow-y-auto p-2"
        style={{ maxHeight: "calc(100svh - 320px)" }}
      >
        {loading ? (
          <>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800"
              />
            ))}
          </>
        ) : (
          <>
            {issues.map((issue) => (
              <IssueCard key={issue.id} issue={issue} />
            ))}

            {hasMore && (
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="mt-1 w-full rounded-lg border border-dashed border-zinc-300 py-2 text-[11px] font-medium text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-300"
              >
                {loadingMore
                  ? "Loading…"
                  : `Load ${Math.min(BOARD_PAGE_SIZE, total - issues.length)} more (${total - issues.length} remaining)`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function IssueCard({ issue }: { issue: TrackingIssue }) {
  const pStyles = priorityStyles(issue.priority);
  const tStyles = issueTypeStyles(issue.issueType);
  const visibleLabels = issue.labels.slice(0, 2);
  const extraLabels = issue.labels.length - 2;

  return (
    <Link
      href={`/issues/${issue.jiraKey}`}
      prefetch={false}
      className="group flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-sm transition-colors hover:border-zinc-300 hover:shadow-md dark:border-zinc-700/60 dark:bg-zinc-900 dark:hover:border-zinc-600"
    >
      {/* Top row: key + type + priority */}
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] font-semibold text-zinc-400 dark:text-zinc-500">
          {issue.jiraKey}
        </span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none",
            tStyles.bg,
            tStyles.text
          )}
        >
          {tStyles.abbr}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <span className={cn("size-1.5 rounded-full", pStyles.dot)} />
          <span className={cn("text-[10px] font-medium", pStyles.text)}>
            {issue.priority ?? "—"}
          </span>
        </div>
        <DelayLogButton issueId={issue.id} />
      </div>

      {/* Summary */}
      <p className="line-clamp-2 font-medium text-zinc-800 group-hover:text-zinc-900 dark:text-zinc-200 dark:group-hover:text-zinc-100">
        {issue.summary}
      </p>

      {/* Labels */}
      {visibleLabels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {visibleLabels.map((l) => (
            <span
              key={l}
              className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            >
              {l}
            </span>
          ))}
          {extraLabels > 0 && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-400 dark:bg-zinc-800">
              +{extraLabels}
            </span>
          )}
        </div>
      )}

      {/* Bottom row: assignee + time */}
      <div className="flex items-center gap-2 text-zinc-400">
        <span className="ml-auto flex items-center gap-1.5">
          {issue.assigneeName ? (
            <span
              className="flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[9px] font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
              title={issue.assigneeName}
            >
              {initials(issue.assigneeName)}
            </span>
          ) : (
            <span className="size-5 shrink-0 rounded-full border border-dashed border-zinc-300 dark:border-zinc-600" />
          )}
          <span className="text-[10px]">
            {formatRelativeTime(issue.jiraUpdatedAt)}
          </span>
        </span>
      </div>
    </Link>
  );
}
