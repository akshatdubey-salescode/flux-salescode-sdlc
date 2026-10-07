"use client";

// Individual, linkable bug rows — fetched from /api/bugs/issues (a direct
// jira_issues read, no JQL involved) and rendered as a plain list, each
// linking straight to the issue in Jira. Shared by the project-Jira modal
// and the missing-issue-owner modal.
import { useEffect, useRef, useState } from "react";
import { RiCheckLine, RiExternalLinkLine, RiFileCopyLine } from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RcaBadge } from "./rca-badge";
import { buildIssuesMessage, type CopyRca } from "@/lib/bugs/copy-issues";
import { localDateStr } from "@/lib/date-utils";

type BugIssueRow = {
  id: string;
  jiraKey: string;
  summary: string;
  priority: string | null;
  status: string;
  statusCategory: string | null;
  projectName: string;
  jiraBaseUrl: string;
  environment: string;
  isCustomerFound: boolean;
  ownerName: string | null;
  assigneeName: string | null;
  createdAt: string | null;
};

type BugIssuesResponse = { issues: BugIssueRow[]; truncated: boolean } | { error: string };

export function BugIssueList({
  projectId,
  unassignedOnly,
  priority,
  ownerKey,
  ownerKeys,
  from,
  to,
  env,
  cfOnly,
  shareTitle,
}: {
  projectId?: string;
  unassignedOnly?: boolean;
  priority?: string;
  /** Scopes the list to one developer's bugs (email/accountId) — omit for everyone. */
  ownerKey?: string;
  /** Scopes the list to several developers (the board's Developers filter) — ignored when ownerKey is set. */
  ownerKeys?: string[];
  from?: string;
  to?: string;
  /** Matches the board's Env chip — same normalized label (Prod/UAT/Demo/…). */
  env?: string;
  /** Matches the board's "Customer-found only" toggle. */
  cfOnly?: boolean;
  /** Scope line for "Copy Issues" (same text as the popup's title, e.g. "CavinKare COE — Rohit Mittal — P3"). */
  shareTitle?: string;
}) {
  // cacheKey/fetchResult (not a plain setData(null)-then-fetch) so "loading"
  // is derived by comparing keys rather than reset synchronously inside the
  // effect — mirrors BugBoardClient's own top-level fetch, and avoids the
  // extra render pass a direct setState-in-effect call would cost.
  const cacheKey = JSON.stringify({ projectId, unassignedOnly, priority, ownerKey, ownerKeys, from, to, env, cfOnly });
  const [fetchResult, setFetchResult] = useState<{ key: string; data: BugIssuesResponse } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (unassignedOnly) params.set("unassignedOnly", "true");
    if (priority) params.set("priority", priority);
    if (ownerKey) params.set("ownerKey", ownerKey);
    else if (ownerKeys?.length) params.set("ownerKeys", ownerKeys.join(","));
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (env) params.set("env", env);
    if (cfOnly) params.set("cfOnly", "true");
    fetch(`/api/bugs/issues?${params}`)
      .then((r) => r.json())
      .then((data) => setFetchResult({ key: cacheKey, data }))
      .catch((e) => setFetchResult({ key: cacheKey, data: { error: String(e) } }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, unassignedOnly, priority, ownerKey, cacheKey, from, to, env, cfOnly]);

  const data = fetchResult?.key === cacheKey ? fetchResult.data : null;

  // RCA for "Copy Issues" is fetched as soon as the list arrives (one batched
  // call, the same endpoint the row badges use) and kept as a promise, so the
  // click handler can hand it straight to the clipboard without losing the
  // browser's user-gesture window to a network round-trip.
  const rcaByKey = useRef<Promise<Record<string, CopyRca | null>> | null>(null);
  useEffect(() => {
    if (!data || "error" in data || data.issues.length === 0) {
      rcaByKey.current = null;
      return;
    }
    const ids = data.issues.map((i) => i.id);
    rcaByKey.current = fetch("/api/bugs/rca-summaries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issueIds: ids }),
    })
      .then((r) => (r.ok ? r.json() : { summaries: {} }))
      .then((d: { summaries: Record<string, CopyRca | null> }) =>
        Object.fromEntries(data.issues.map((i) => [i.jiraKey, d.summaries[i.id] ?? null])),
      )
      .catch(() => ({}));
  }, [data]);

  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  async function handleCopyIssues() {
    if (!data || "error" in data) return;
    const issues = data.issues;
    const textPromise = (rcaByKey.current ?? Promise.resolve({})).then((rca) =>
      buildIssuesMessage({
        title: shareTitle ?? "Bug Board issues",
        from, to, env, cfOnly,
        issues,
        rca,
        truncated: data.truncated,
        today: localDateStr(new Date()),
      }),
    );
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ "text/plain": textPromise.then((t) => new Blob([t], { type: "text/plain" })) }),
        ]);
      } else {
        await navigator.clipboard.writeText(await textPromise);
      }
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 2000);
  }

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
      <div className="flex items-center justify-between pb-1">
        <span className="text-[11px] text-muted-foreground">
          {data.issues.length} issue{data.issues.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={handleCopyIssues}
          className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          {copyState === "copied" ? (
            <><RiCheckLine size={12} /> Copied!</>
          ) : copyState === "error" ? (
            <>Copy failed</>
          ) : (
            <><RiFileCopyLine size={12} /> Copy Issues</>
          )}
        </button>
      </div>
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
            <span className="flex w-44 shrink-0 items-center justify-end gap-1.5">
              <RcaBadge issueId={issue.id} />
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {issue.isCustomerFound ? "Customer" : "QA"}
              </Badge>
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
