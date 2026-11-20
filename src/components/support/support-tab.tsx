"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TicketsTable } from "./tickets-table";
import { ReportsView } from "./reports-view";
import { SettingsForm } from "./settings-form";

type View = "tickets" | "reports" | "settings";

/** Support tab: Tickets / Reports / Settings (admin only), synced to `?view=`. */
export function SupportTab({ projectId, isAdmin }: { projectId: string; isAdmin: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.get("view");
  const view: View = raw === "reports" || (raw === "settings" && isAdmin) ? raw : "tickets";

  function handleChange(value: string) {
    // Keep `tab` (and anything else) so the outer project tab stays put.
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", value);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  return (
    <Tabs value={view} onValueChange={handleChange} className="space-y-4">
      <TabsList>
        <TabsTrigger value="tickets">Tickets</TabsTrigger>
        <TabsTrigger value="reports">Reports</TabsTrigger>
        {isAdmin && <TabsTrigger value="settings">Settings</TabsTrigger>}
      </TabsList>

      <TabsContent value="tickets">
        <TicketsTable projectId={projectId} />
      </TabsContent>
      <TabsContent value="reports">
        <ReportsView projectId={projectId} />
      </TabsContent>
      {isAdmin && (
        <TabsContent value="settings">
          <SettingsForm projectId={projectId} />
        </TabsContent>
      )}
    </Tabs>
  );
}
