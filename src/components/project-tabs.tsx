"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RiRefreshLine } from "@remixicon/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

type Props = {
  projectId: string;
  isAdmin: boolean;
};

const VALID_TABS = ["overview", "project-tracking", "sla-engine"] as const;
type Tab = (typeof VALID_TABS)[number];

function isValidTab(value: string | null): value is Tab {
  return VALID_TABS.includes(value as Tab);
}

export function ProjectTabs({ projectId, isAdmin }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const activeTab: Tab =
    isValidTab(rawTab) && (rawTab !== "sla-engine" || isAdmin)
      ? rawTab
      : "overview";

  const [syncing, setSyncing] = useState(false);

  function handleTabChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.replace(`?${params.toString()}`, { scroll: false });
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
        </TabsList>
        <Button variant="outline" size="sm" onClick={handleForceSync} disabled={syncing}>
          <RiRefreshLine className={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing…" : "Force sync"}
        </Button>
      </div>

      <div className="p-6">
        <TabsContent value="overview">
          <Placeholder label="Overview" />
        </TabsContent>

        <TabsContent value="project-tracking">
          <Placeholder label="Project Tracking" />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="sla-engine">
            <Placeholder label="SLA Engine" />
          </TabsContent>
        )}
      </div>
    </Tabs>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-200 p-12 text-center dark:border-zinc-800">
      <p className="text-xs text-zinc-400">{label} — coming soon</p>
    </div>
  );
}
