"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { RiRefreshLine } from "@remixicon/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SlaEngineTab } from "@/components/sla-engine";
import { ProjectTrackingTab } from "@/components/project-tracking";
import { StatusMappingTabContent } from "@/components/status-mapping-editor";
import { ProjectOverviewDashboard } from "@/components/project-overview/project-dashboard";
import { ClientIssuesTab } from "@/components/client-issues";
import { BugSummaryTab } from "@/components/bug-summary";
import { ProjectTeamClient } from "@/components/observer/team-timeline-client";

type SyncJob = {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  totalIssues: number | null;
  syncedCount: number;
  errorCount: number;
};

type Props = {
  projectId: string;
  projectName: string;
  hasFreshdesk: boolean;
  isAdmin: boolean;
  isSuperuser: boolean;
};

const VALID_TABS = ["overview", "project-tracking", "team", "bug-summary", "sla-engine", "status-mapping", "client-issues"] as const;
type Tab = (typeof VALID_TABS)[number];

function isValidTab(value: string | null): value is Tab {
  return VALID_TABS.includes(value as Tab);
}

export function ProjectTabs({ projectId, projectName, hasFreshdesk, isAdmin, isSuperuser }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const activeTab: Tab =
    isValidTab(rawTab) &&
    (rawTab !== "sla-engine" || isAdmin) &&
    (rawTab !== "status-mapping" || isAdmin)
      ? rawTab
      : "overview";

  const [syncJob, setSyncJob] = useState<SyncJob | null>(null);
  const [isPending, startTransition] = useTransition();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncConfirmText, setSyncConfirmText] = useState("");

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function startPolling(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    // 5s is the sweet spot between perceived responsiveness and burning
    // function invocations: a Jira sync usually completes in 30s-5min, so a
    // 5s poll still surfaces completion within one user-noticeable beat
    // while cutting invocations to ~2.5x less than the previous 2s cadence.
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/sync-jobs/${jobId}`);
      if (!res.ok) return;
      const job: SyncJob = await res.json();
      setSyncJob(job);
      if (job.status === "completed" || job.status === "failed") {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        router.refresh();
      }
    }, 5000);
  }

  function handleTabChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    startTransition(() => {
      router.replace(`?${params.toString()}`, { scroll: false });
    });
  }

  async function handleForceSync() {
    const res = await fetch(`/api/projects/${projectId}/sync`, {
      method: "POST",
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.jobId) {
      setSyncJob({ id: data.jobId, status: "pending", totalIssues: null, syncedCount: 0, errorCount: 0 });
      startPolling(data.jobId);
    }
  }

  const isSyncing = syncJob?.status === "pending" || syncJob?.status === "running";

  function syncLabel() {
    if (syncJob?.status === "pending") return "Queued…";
    if (syncJob?.status === "running") {
      if (syncJob.totalIssues) {
        return `Syncing… ${syncJob.syncedCount}/${syncJob.totalIssues}`;
      }
      return "Syncing…";
    }
    return "Force sync";
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="project-tracking">Project Tracking</TabsTrigger>
          <TabsTrigger value="team">Team Tracking</TabsTrigger>
          <TabsTrigger value="bug-summary">Bug Summary</TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="sla-engine">SLA Engine</TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="status-mapping">Status Mapping</TabsTrigger>
          )}
          {hasFreshdesk && (
            <TabsTrigger value="client-issues">Client Issue Tracker</TabsTrigger>
          )}
        </TabsList>
        {isSuperuser && (
          isSyncing ? (
            <Button variant="outline" size="sm" disabled>
              <RiRefreshLine className="animate-spin" />
              {syncLabel()}
            </Button>
          ) : (
            <AlertDialog
              open={syncDialogOpen}
              onOpenChange={(o) => { setSyncDialogOpen(o); if (!o) setSyncConfirmText(""); }}
            >
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <RiRefreshLine />
                  Force sync
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Sync {projectName}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Syncing is an expensive operation — it re-fetches all issues from Jira and
                    may take several minutes. Use carefully, or perform this operation in the
                    local development environment.
                    <br /><br />
                    Type <span className="font-mono font-medium text-foreground">sync {projectName}</span> to confirm.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Input
                  placeholder={`sync ${projectName}`}
                  value={syncConfirmText}
                  onChange={(e) => setSyncConfirmText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && syncConfirmText === `sync ${projectName}`) {
                      setSyncDialogOpen(false);
                      setSyncConfirmText("");
                      handleForceSync();
                    }
                  }}
                  autoFocus
                />
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={syncConfirmText !== `sync ${projectName}`}
                    onClick={() => { setSyncDialogOpen(false); setSyncConfirmText(""); handleForceSync(); }}
                  >
                    Sync
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )
        )}
      </div>

      <div className="p-6">
        {isPending ? (
          <TabContentSkeleton />
        ) : (
          <>
            <TabsContent value="overview">
              <ProjectOverviewDashboard projectId={projectId} />
            </TabsContent>

            <TabsContent value="project-tracking">
              <ProjectTrackingTab projectId={projectId} />
            </TabsContent>

            <TabsContent value="team">
              <ProjectTeamClient projectId={projectId} name={projectName} />
            </TabsContent>

            <TabsContent value="bug-summary">
              <BugSummaryTab projectId={projectId} projectName={projectName} />
            </TabsContent>

            {isAdmin && (
              <TabsContent value="sla-engine">
                <SlaEngineTab projectId={projectId} />
              </TabsContent>
            )}
            {isAdmin && (
              <TabsContent value="status-mapping">
                <StatusMappingTabContent projectId={projectId} />
              </TabsContent>
            )}
            {hasFreshdesk && (
              <TabsContent value="client-issues">
                <ClientIssuesTab projectId={projectId} projectName={projectName} />
              </TabsContent>
            )}
          </>
        )}
      </div>
    </Tabs>
  );
}

function TabContentSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-4/6" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-200 p-12 text-center dark:border-zinc-800">
      <p className="text-xs text-zinc-400">{label} — coming soon</p>
    </div>
  );
}
