"use client";

// Self-only "my open PRs" panel — the data github_pull_requests holds is only
// ever refreshed by a superuser's manual "Sync LOC" run (no cron, see
// loc-sync.ts), so this is deliberately upfront about staleness (lastSyncedAt)
// rather than presenting itself as a live PR feed.
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartInfo } from "@/components/ui/chart-info";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RiExternalLinkLine, RiGitPullRequestLine } from "@remixicon/react";

type MyOpenPullRequest = {
  number: number;
  title: string;
  headRef: string;
  createdAt: string;
  daysOpen: number;
  additions: number | null;
  deletions: number | null;
  repoFullName: string;
};

type MyGithubActivity = {
  unmapped: boolean;
  pullRequests: MyOpenPullRequest[];
  lastSyncedAt: string | null;
};

export function MyGithubActivity() {
  const [data, setData] = useState<MyGithubActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/github/my-activity")
      .then((res) => {
        if (!res.ok) throw new Error(`request failed: ${res.status}`);
        return res.json();
      })
      .then((data) => setData(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <Skeleton className="h-64 rounded-lg" />;
  }

  if (error || !data) {
    return (
      <div className="pt-4">
        <EmptyState message="Couldn't load your pull requests right now — try refreshing the page." />
      </div>
    );
  }

  return (
    <div className="pt-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <RiGitPullRequestLine className="size-4" />
            My Open Pull Requests
          </CardTitle>
          <CardAction>
            <ChartInfo description="Not a live feed — this list only reflects PRs seen during the last manual Sync LOC run (Performance Review > Sync LOC), which a superuser triggers on demand. It can lag behind what's actually open on GitHub." />
          </CardAction>
        </CardHeader>
        <CardContent>
          {data.unmapped ? (
            <EmptyState message="Your GitHub account isn't linked yet — ask a superuser to map it under GitHub Accounts." />
          ) : data.pullRequests.length === 0 ? (
            <EmptyState message="No open pull requests as of the last sync — nice and clean." />
          ) : (
            <div className="divide-y divide-border/50">
              {data.pullRequests.map((pr) => (
                <PullRequestRow key={`${pr.repoFullName}#${pr.number}`} pr={pr} />
              ))}
            </div>
          )}
          {data.lastSyncedAt && (
            <p className="mt-3 text-[10px] text-muted-foreground">
              As of the last sync: {new Date(data.lastSyncedAt).toLocaleDateString()}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PullRequestRow({ pr }: { pr: MyOpenPullRequest }) {
  const url = `https://github.com/${pr.repoFullName}/pull/${pr.number}`;
  const stale = pr.daysOpen >= 7;

  return (
    <div className="py-2.5 first:pt-0 last:pb-0 space-y-1">
      <div className="flex items-start justify-between gap-3">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-primary transition-colors line-clamp-1 leading-relaxed min-w-0"
          title={pr.title}
        >
          <span className="truncate">{pr.title}</span>
          <RiExternalLinkLine className="size-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
        </a>
        <Badge
          variant={stale ? "destructive" : "secondary"}
          className="shrink-0 gap-1 tabular-nums"
        >
          {pr.daysOpen === 0 ? "today" : `${pr.daysOpen}d open`}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
          {pr.repoFullName}#{pr.number}
        </span>
        {pr.additions != null && pr.deletions != null && (
          <span className="text-[10px] tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">+{pr.additions}</span>{" "}
            <span className="text-destructive">-{pr.deletions}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className={cn("flex items-center justify-center py-8 text-center")}>
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
