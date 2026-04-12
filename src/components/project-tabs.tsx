"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { RiRefreshLine } from "@remixicon/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { SlaEngineTab } from "@/components/sla-engine";
import { ProjectTrackingTab } from "@/components/project-tracking";
import { StatusMappingTabContent } from "@/components/status-mapping-editor";
import { ProjectOverviewDashboard } from "@/components/project-overview/project-dashboard";

type SyncJob = {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  totalIssues: number | null;
  syncedCount: number;
  errorCount: number;
};

type Props = {
  projectId: string;
  isAdmin: boolean;
  isSuperuser: boolean;
};

const VALID_TABS = ["overview", "project-tracking", "sla-engine", "status-mapping"] as const;
type Tab = (typeof VALID_TABS)[number];

function isValidTab(value: string | null): value is Tab {
  return VALID_TABS.includes(value as Tab);
}

export function ProjectTabs({ projectId, isAdmin, isSuperuser }: Props) {
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

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function startPolling(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
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
    }, 2000);
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
          {isAdmin && (
            <TabsTrigger value="sla-engine">SLA Engine</TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="status-mapping">Status Mapping</TabsTrigger>
          )}
        </TabsList>
        {isSuperuser && (
          <Button variant="outline" size="sm" onClick={handleForceSync} disabled={isSyncing}>
            <RiRefreshLine className={isSyncing ? "animate-spin" : ""} />
            {syncLabel()}
          </Button>
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
