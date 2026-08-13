"use client";

// Self-only "My LOC Sync Status" panel — shows every completed Jira credited
// to the signed-in user this quarter and whether its LOC has synced yet (see
// loc-sync-status-panel.tsx). The open-PR list this component used to show
// was discarded — this is the only content here now.
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartInfo } from "@/components/ui/chart-info";
import { Skeleton } from "@/components/ui/skeleton";
import { RiGitPullRequestLine } from "@remixicon/react";
import { LocSyncStatusPanel } from "@/components/loc-sync-status-panel";
import { currentQuarter } from "@/lib/scorecard/quarter";

type MyGithubActivity = {
  unmapped: boolean;
  email: string;
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
        <EmptyState message="Couldn't load your GitHub activity right now — try refreshing the page." />
      </div>
    );
  }

  if (data.unmapped) {
    return (
      <div className="pt-4">
        <EmptyState message="Your GitHub account isn't linked yet — ask a superuser to map it under GitHub Accounts." />
      </div>
    );
  }

  return (
    <div className="pt-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <RiGitPullRequestLine className="size-4" />
            My LOC Sync Status
          </CardTitle>
          <CardAction>
            <ChartInfo description="Every completed Jira credited to you this quarter, whether its LOC synced yet, and why not if it hasn't — matched Jira/PR links included." />
          </CardAction>
        </CardHeader>
        <CardContent>
          <LocSyncStatusPanel email={data.email} quarterKey={currentQuarter().key} />
        </CardContent>
      </Card>
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
