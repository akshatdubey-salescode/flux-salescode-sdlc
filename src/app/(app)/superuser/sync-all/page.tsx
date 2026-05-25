import { asc, eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { SyncAllPanel } from "@/components/superuser/sync-all-panel";

export default async function SyncAllPage() {
  await requireRole("SUPERUSER");

  const projects = await db
    .select({
      id: jiraProjects.id,
      name: jiraProjects.name,
      jiraProjectKey: jiraProjects.jiraProjectKey,
      lastSyncedAt: jiraProjects.lastSyncedAt,
    })
    .from(jiraProjects)
    .where(eq(jiraProjects.isActive, true))
    .orderBy(asc(jiraProjects.name));

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Sync All Projects</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <main className="flex-1 p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sync All Projects</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Force-sync all active Jira projects one at a time.
            </p>
          </div>
          <SyncAllPanel projects={projects} />
        </div>
      </main>
    </div>
  );
}
