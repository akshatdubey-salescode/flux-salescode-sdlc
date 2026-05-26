export type TrackingIssue = {
  id: string;
  jiraKey: string;
  summary: string;
  status: string;
  statusCategory: string | null;
  issueType: string;
  priority: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  reporterName: string | null;
  reporterEmail: string | null;
  labels: string[];
  jiraCreatedAt: string | null;
  jiraUpdatedAt: string | null;
  jiraBaseUrl: string | null;
};

export type TrackingFields = {
  statuses: { status: string; statusCategory: string | null }[];
  priorities: string[];
  issueTypes: string[];
  assignees: { email: string; name: string }[];
  reporters: { email: string; name: string }[];
  labels: string[];
};

export type FilterState = {
  q: string;
  status: string[];
  priority: string[];
  assignee: string[];
  reporter: string[];
  issueType: string[];
  labels: string[];
  dateFrom: string;
  dateTo: string;
  showCompleted: boolean;
  sortBy: string;
  sortDir: "asc" | "desc";
  view: "board" | "list";
  page: number;
};

// ---------------------------------------------------------------------------
// Status / category helpers
// ---------------------------------------------------------------------------

/**
 * Maps a Jira statusCategory name to a canonical sort order.
 * Normalised to lowercase + trimmed so casing differences from Jira don't break ordering.
 * Common Jira category aliases:
 *   "new" / "undefined" → To Do  (order 0)
 *   "indeterminate"     → In Progress (order 1)
 *   "done"              → Done (order 2)
 */
const STATUS_CATEGORY_ORDER: Record<string, number> = {
  // To Do variants
  "to do": 0,
  new: 0,
  undefined: 0,
  // In Progress variants
  "in progress": 1,
  indeterminate: 1,
  // Done variants
  done: 2,
  complete: 2,
};

function categoryOrder(category: string | null): number {
  const key = (category ?? "").trim().toLowerCase();
  return STATUS_CATEGORY_ORDER[key] ?? 3;
}

export function sortStatusesByCategory(
  statuses: Array<{ status: string; statusCategory: string | null }>
) {
  return [...statuses].sort((a, b) => {
    const oa = categoryOrder(a.statusCategory);
    const ob = categoryOrder(b.statusCategory);
    if (oa !== ob) return oa - ob;
    // Within the same category, sort statuses alphabetically for stability
    return a.status.localeCompare(b.status);
  });
}

export function statusCategoryStyles(category: string | null) {
  const key = (category ?? "").trim().toLowerCase();
  if (key === "done" || key === "complete") {
    return {
      border: "border-l-emerald-400",
      badge:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    };
  }
  if (key === "in progress" || key === "indeterminate") {
    return {
      border: "border-l-blue-400",
      badge:
        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    };
  }
  // "to do", "new", "undefined", or unrecognised → neutral zinc
  return {
    border: "border-l-zinc-300 dark:border-l-zinc-600",
    badge: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  };
}

// ---------------------------------------------------------------------------
// Priority helpers
// ---------------------------------------------------------------------------

const PRIORITY_STYLES: Record<string, { dot: string; text: string }> = {
  Highest: { dot: "bg-red-500", text: "text-red-600 dark:text-red-400" },
  High: { dot: "bg-orange-500", text: "text-orange-600 dark:text-orange-400" },
  Medium: {
    dot: "bg-yellow-400",
    text: "text-yellow-600 dark:text-yellow-400",
  },
  Low: { dot: "bg-blue-400", text: "text-blue-600 dark:text-blue-400" },
  Lowest: { dot: "bg-zinc-400", text: "text-zinc-500 dark:text-zinc-400" },
};

export function priorityStyles(priority: string | null) {
  return (
    PRIORITY_STYLES[priority ?? ""] ?? {
      dot: "bg-zinc-300",
      text: "text-zinc-400",
    }
  );
}

// ---------------------------------------------------------------------------
// Issue type helpers
// ---------------------------------------------------------------------------

const ISSUE_TYPE_STYLES: Record<string, { bg: string; text: string; abbr: string }> =
  {
    Bug: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-600 dark:text-red-400", abbr: "B" },
    Story: { bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-400", abbr: "S" },
    Task: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-400", abbr: "T" },
    Epic: { bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-700 dark:text-purple-400", abbr: "E" },
    Subtask: { bg: "bg-sky-100 dark:bg-sky-900/30", text: "text-sky-700 dark:text-sky-400", abbr: "S" },
  };

export function issueTypeStyles(type: string) {
  return (
    ISSUE_TYPE_STYLES[type] ?? {
      bg: "bg-zinc-100 dark:bg-zinc-800",
      text: "text-zinc-500 dark:text-zinc-400",
      abbr: type[0]?.toUpperCase() ?? "?",
    }
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function initials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((p) => p[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

export function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diffMs = Date.now() - new Date(dateStr).getTime();
  if (diffMs < 60_000) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export const SORT_OPTIONS = [
  { value: "updated", label: "Updated" },
  { value: "created", label: "Created" },
  { value: "priority", label: "Priority" },
  { value: "status", label: "Status" },
] as const;
