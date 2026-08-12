"use client";

// Individual, linkable bug rows — fetched from /api/bugs/issues (a direct
// jira_issues read, no JQL involved) and rendered as a plain list, each
// linking straight to the issue in Jira. Shared by the project-Jira modal
// and the missing-issue-owner modal.
import { useEffect, useState } from "react";
import { RiExternalLinkLine } from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type BugIssueRow = {
  jiraKey: string;
  summary: string;
  priority: string | null;
  status: string;
  statusCategory: string | null;
  projectName: string;
  jiraBaseUrl: string;
};

type BugIssuesResponse = { issues: BugIssueRow[]; truncated: boolean } | { error: string };

export function BugIssueList({
  projectId,
  unassignedOnly,
  priority,
  ownerKey,
  from,
  to,
}: {
  projectId?: string;
  unassignedOnly?: boolean;
  priority?: string;
  /** Scopes the list to one developer's bugs (email/accountId) — omit for everyone. */
  ownerKey?: string;
  from?: string;
  to?: string;
}) {
  // cacheKey/fetchResult (not a plain setData(null)-then-fetch) so "loading"
  // is derived by comparing keys rather than reset synchronously inside the
  // effect — mirrors BugBoardClient's own top-level fetch, and avoids the
  // extra render pass a direct setState-in-effect call would cost.
  const cacheKey = JSON.stringify({ projectId, unassignedOnly, priority, ownerKey, from, to });
  const [fetchResult, setFetchResult] = useState<{ key: string; data: BugIssuesResponse } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (unassignedOnly) params.set("unassignedOnly", "true");
    if (priority) params.set("priority", priority);
    if (ownerKey) params.set("ownerKey", ownerKey);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    fetch(`/api/bugs/issues?${params}`)
      .then((r) => r.json())
      .then((data) => setFetchResult({ key: cacheKey, data }))
      .catch((e) => setFetchResult({ key: cacheKey, data: { error: String(e) } }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, unassignedOnly, priority, ownerKey, from, to]);

  const data = fetchResult?.key === cacheKey ? fetchResult.data : null;

  if (!data) {
    return (
      <div className="space-y-2">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-10 rounded-md" />
        ))}
      </div>
    );
  }

  if ("error" in data) {
    return <p className="py-8 text-center text-xs text-destructive">Failed to load: {data.error}</p>;
  }

  if (data.issues.length === 0) {
    return <p className="py-8 text-center text-xs text-muted-foreground">No matching issues.</p>;
  }

  return (
    <div className="space-y-1">
      <div className="divide-y divide-border/50">
        {data.issues.map((issue) => (
          <a
            key={issue.jiraKey}
            href={`${issue.jiraBaseUrl.replace(/\/+$/, "")}/browse/${issue.jiraKey}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between gap-3 rounded-md px-3 py-2 text-xs hover:bg-muted/50"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                {issue.jiraKey}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground group-hover:text-primary">
                {issue.summary}
              </span>
              <RiExternalLinkLine className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-60" />
            </span>
            <span className="flex w-32 shrink-0 items-center justify-end gap-1.5">
              {issue.priority && <Badge variant="outline" className="shrink-0">{issue.priority}</Badge>}
              <span className="min-w-0 truncate text-[10px] text-muted-foreground" title={issue.status}>
                {issue.status}
              </span>
            </span>
          </a>
        ))}
      </div>
      {data.truncated && (
        <p className="pt-2 text-center text-[10px] text-muted-foreground">
          Showing the first {data.issues.length} — narrow the date range for the rest.
        </p>
      )}
    </div>
  );
}
