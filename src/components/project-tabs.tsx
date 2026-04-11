"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { RiRefreshLine } from "@remixicon/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { SlaEngineTab } from "@/components/sla-engine";
import { ProjectTrackingTab } from "@/components/project-tracking";
import { StatusMappingTabContent } from "@/components/status-mapping-editor";

type Props = {
  projectId: string;
  isAdmin: boolean;
};

const VALID_TABS = ["overview", "project-tracking", "sla-engine", "status-mapping"] as const;
type Tab = (typeof VALID_TABS)[number];

function isValidTab(value: string | null): value is Tab {
  return VALID_TABS.includes(value as Tab);
}

export function ProjectTabs({ projectId, isAdmin }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const activeTab: Tab =
    isValidTab(rawTab) &&
    (rawTab !== "sla-engine" || isAdmin) &&
    (rawTab !== "status-mapping" || isAdmin)
      ? rawTab
      : "overview";

  const [syncing, setSyncing] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleTabChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    startTransition(() => {
      router.replace(`?${params.toString()}`, { scroll: false });
    });
  }

  async function handleForceSync() {
    setSyncing(true);
    try {
      await fetch(`/api/projects/${projectId}/sync`, { method: "POST" });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
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
        <Button variant="outline" size="sm" onClick={handleForceSync} disabled={syncing}>
          <RiRefreshLine className={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing…" : "Force sync"}
        </Button>
      </div>

      <div className="p-6">
        {isPending ? (
          <TabContentSkeleton />
        ) : (
          <>
            <TabsContent value="overview">
              <Placeholder label="Overview" />
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
