"use client";

import { Fragment } from "react";
import Link from "next/link";
import {
  RiArrowUpSLine,
  RiArrowDownSLine,
  RiArrowUpDownLine,
  RiChatSmileLine,
  RiPushpinLine,
  RiPushpinFill,
} from "@remixicon/react";
import { cn } from "@/lib/utils";
import {
  TrackingIssue,
  statusCategoryStyles,
  priorityStyles,
  issueTypeStyles,
  initials,
  formatRelativeTime,
} from "./helpers";
import { SORT_OPTIONS } from "./helpers";

type Props = {
  issues: TrackingIssue[];
  loading: boolean;
  total: number;
  page: number;
  totalPages: number;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSortChange: (sortBy: string, sortDir: "asc" | "desc") => void;
  onPageChange: (page: number) => void;
  pinnedKeys?: Set<string>;
  onPinToggle?: (jiraKey: string) => void;
  pinnedCount?: number;
};

const SORTABLE_COLS: Record<string, string> = {
  summary: "summary",
  status: "status",
  priority: "priority",
  updated: "updated",
  created: "created",
};

export function ListView({
  issues,
  loading,
  total,
  page,
  totalPages,
  sortBy,
  sortDir,
  onSortChange,
  onPageChange,
  pinnedKeys,
  onPinToggle,
  pinnedCount = 0,
}: Props) {
  function handleColSort(col: string) {
    if (sortBy === col) {
      onSortChange(col, sortDir === "asc" ? "desc" : "asc");
    } else {
      onSortChange(col, "desc");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                {onPinToggle && <th className="w-6 px-2 py-2.5" />}
                <th className="w-8 px-3 py-2.5" />
                <SortableHeader
                  label="Key"
                  colKey="key"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={handleColSort}
                  className="w-24"
                />
                <SortableHeader
                  label="Summary"
                  colKey="summary"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={handleColSort}
                />
                <SortableHeader
                  label="Status"
                  colKey="status"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={handleColSort}
                  className="w-36"
                />
                <SortableHeader
                  label="Priority"
                  colKey="priority"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={handleColSort}
                  className="w-28"
                />
                <th className="px-3 py-2.5 text-left font-medium text-zinc-500 w-20">
                  Assign.
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-zinc-500 w-20">
                  Reporter
                </th>
                <th className="px-3 py-2.5 text-right font-medium text-zinc-500 w-8">
                  <span title="Comments">
                    <RiChatSmileLine className="size-3.5 ml-auto" />
                  </span>
                </th>
                <SortableHeader
                  label="Updated"
                  colKey="updated"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={handleColSort}
                  className="w-24 text-right"
                />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {loading
                ? Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={onPinToggle ? 10 : 9} className="px-3 py-2.5">
                        <div className="h-3.5 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                      </td>
                    </tr>
                  ))
                : issues.length === 0
                ? (
                    <tr>
                      <td
                        colSpan={onPinToggle ? 10 : 9}
                        className="px-4 py-12 text-center text-zinc-400"
                      >
                        No issues found. Try adjusting your filters.
                      </td>
                    </tr>
                  )
                : issues.map((issue, idx) => (
                    <Fragment key={issue.id}>
                      {onPinToggle && pinnedCount > 0 && idx === pinnedCount && (
                        <tr className="pointer-events-none">
                          <td colSpan={10} className="h-px bg-amber-200/60 dark:bg-amber-700/30 p-0" />
                        </tr>
                      )}
                      <IssueRow
                        issue={issue}
                        pinned={pinnedKeys?.has(issue.jiraKey)}
                        onPinToggle={onPinToggle}
                      />
                    </Fragment>
                  ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {!loading && total > 0 && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>
            Showing {(page - 1) * 50 + 1}–{Math.min(page * 50, total)} of{" "}
            {total} issues
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="rounded border border-zinc-200 px-2.5 py-1 font-medium hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Previous
            </button>
            <span className="px-2">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="rounded border border-zinc-200 px-2.5 py-1 font-medium hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortableHeader({
  label,
  colKey,
  sortBy,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  colKey: string;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSort: (key: string) => void;
  className?: string;
}) {
  const active = sortBy === colKey;
  return (
    <th
      className={cn("px-3 py-2.5 text-left font-medium text-zinc-500", className)}
    >
      <button
        onClick={() => onSort(colKey)}
        className="inline-flex items-center gap-1 hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <RiArrowUpSLine className="size-3.5" />
          ) : (
            <RiArrowDownSLine className="size-3.5" />
          )
        ) : (
          <RiArrowUpDownLine className="size-3 opacity-30" />
        )}
      </button>
    </th>
  );
}

function IssueRow({
  issue,
  pinned,
  onPinToggle,
}: {
  issue: TrackingIssue;
  pinned?: boolean;
  onPinToggle?: (jiraKey: string) => void;
}) {
  const pStyles = priorityStyles(issue.priority);
  const tStyles = issueTypeStyles(issue.issueType);
  const sStyles = statusCategoryStyles(issue.statusCategory);

  return (
    <tr
      className={cn(
        "transition-colors",
        pinned
          ? "bg-amber-50/70 hover:bg-amber-50 dark:bg-amber-950/20 dark:hover:bg-amber-950/30"
          : "bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900/60"
      )}
    >
      {/* Pin button */}
      {onPinToggle && (
        <td className="px-2 py-2">
          <button
            onClick={() => onPinToggle(issue.jiraKey)}
            title={pinned ? "Unpin" : "Pin to top"}
            className={cn(
              "flex size-5 items-center justify-center rounded transition-colors",
              pinned
                ? "text-amber-500 hover:text-amber-600"
                : "text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400"
            )}
          >
            {pinned ? (
              <RiPushpinFill className="size-3.5" />
            ) : (
              <RiPushpinLine className="size-3.5" />
            )}
          </button>
        </td>
      )}
      {/* Type icon */}
      <td className="px-3 py-2">
        <span
          className={cn(
            "flex size-5 items-center justify-center rounded text-[10px] font-bold",
            tStyles.bg,
            tStyles.text
          )}
          title={issue.issueType}
        >
          {tStyles.abbr}
        </span>
      </td>

      {/* Key */}
      <td className="px-3 py-2">
        <Link
          href={`/issues/${issue.jiraKey}`}
          prefetch={false}
          className="font-mono font-semibold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          {issue.jiraKey}
        </Link>
      </td>

      {/* Summary */}
      <td className="px-3 py-2 max-w-0">
        <Link
          href={`/issues/${issue.jiraKey}`}
          prefetch={false}
          className="block truncate font-medium text-zinc-800 hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-50"
          title={issue.summary}
        >
          {issue.summary}
        </Link>
      </td>

      {/* Status */}
      <td className="px-3 py-2">
        <span
          className={cn(
            "inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold",
            sStyles.badge
          )}
        >
          {issue.status}
        </span>
      </td>

      {/* Priority */}
      <td className="px-3 py-2">
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", pStyles.dot)} />
          <span className={cn("font-medium", pStyles.text)}>
            {issue.priority ?? "—"}
          </span>
        </span>
      </td>

      {/* Assignee */}
      <td className="px-3 py-2">
        {issue.assigneeName ? (
          <span
            className="flex size-6 items-center justify-center rounded-full bg-zinc-200 text-[9px] font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
            title={issue.assigneeName}
          >
            {initials(issue.assigneeName)}
          </span>
        ) : (
          <span className="text-zinc-300 dark:text-zinc-600">—</span>
        )}
      </td>

      {/* Reporter */}
      <td className="px-3 py-2">
        {issue.reporterName ? (
          <span
            className="flex size-6 items-center justify-center rounded-full bg-zinc-200 text-[9px] font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
            title={issue.reporterName}
          >
            {initials(issue.reporterName)}
          </span>
        ) : (
          <span className="text-zinc-300 dark:text-zinc-600">—</span>
        )}
      </td>

      {/* Comments */}
      <td className="px-3 py-2 text-right">
        {issue.commentCount > 0 ? (
          <span className="text-zinc-400">{issue.commentCount}</span>
        ) : (
          <span className="text-zinc-200 dark:text-zinc-700">—</span>
        )}
      </td>

      {/* Updated */}
      <td className="px-3 py-2 text-right text-zinc-400">
        {formatRelativeTime(issue.jiraUpdatedAt)}
      </td>
    </tr>
  );
}
