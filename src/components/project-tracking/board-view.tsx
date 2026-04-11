"use client";

import Link from "next/link";
import { RiChatSmileLine } from "@remixicon/react";
import { cn } from "@/lib/utils";
import {
  TrackingIssue,
  sortStatusesByCategory,
  statusCategoryStyles,
  priorityStyles,
  issueTypeStyles,
  initials,
  formatRelativeTime,
} from "./helpers";

type Props = {
  issues: TrackingIssue[];
  loading: boolean;
};

export function BoardView({ issues, loading }: Props) {
  if (loading) {
    return <BoardSkeleton />;
  }

  if (issues.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-200 p-16 text-center dark:border-zinc-800">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          No issues found
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          Try adjusting your filters.
        </p>
      </div>
    );
  }

  // Build status → category map from issues
  const statusMap = new Map<string, string | null>();
  for (const issue of issues) {
    if (!statusMap.has(issue.status)) {
      statusMap.set(issue.status, issue.statusCategory);
    }
  }

  const columns = sortStatusesByCategory(
    Array.from(statusMap.entries()).map(([status, statusCategory]) => ({
      status,
      statusCategory,
    }))
  );

  const issuesByStatus = new Map<string, TrackingIssue[]>(
    columns.map((c) => [c.status, []])
  );
  for (const issue of issues) {
    issuesByStatus.get(issue.status)?.push(issue);
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-6 px-6">
      {columns.map((col) => {
        const colIssues = issuesByStatus.get(col.status) ?? [];
        const styles = statusCategoryStyles(col.statusCategory);

        return (
          <div
            key={col.status}
            className={cn(
              "flex w-72 shrink-0 flex-col rounded-xl border-l-[3px] bg-zinc-50 dark:bg-zinc-900/60",
              styles.border
            )}
          >
            {/* Column header */}
            <div className="flex items-center gap-2 px-3 pt-3 pb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 truncate flex-1">
                {col.status}
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-px text-[10px] font-semibold leading-none",
                  styles.badge
                )}
              >
                {colIssues.length}
              </span>
            </div>

            {/* Cards */}
            <div
              className="flex flex-col gap-2 overflow-y-auto p-2"
              style={{ maxHeight: "calc(100svh - 320px)" }}
            >
              {colIssues.map((issue) => (
                <IssueCard key={issue.id} issue={issue} />
              ))}
            </div>
          </div>
        );
      })}
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

      {/* Bottom row: comment count + assignee + time */}
      <div className="flex items-center gap-2 text-zinc-400">
        {issue.commentCount > 0 && (
          <span className="flex items-center gap-0.5">
            <RiChatSmileLine className="size-3" />
            <span className="text-[10px]">{issue.commentCount}</span>
          </span>
        )}
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

function BoardSkeleton() {
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
