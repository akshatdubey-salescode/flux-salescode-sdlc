import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { userIntegrations } from "@/lib/db/schema";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { CalendarSyncPanel } from "@/components/superuser/calendar-sync-panel";

export default async function CalendarSyncPage() {
  await requireRole("SUPERUSER");

  const connected = await db
    .select({ userId: userIntegrations.userId })
    .from(userIntegrations)
    .where(eq(userIntegrations.provider, "google"));

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/superuser">Superuser</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Calendar Sync</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Calendar Sync</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Manually trigger the Google Calendar sync that normally runs on a cron
              schedule. Fetches the latest events for all users who have connected
              their Google account.
            </p>
          </div>

          <CalendarSyncPanel connectedUsers={connected.length} />
        </div>
      </main>
    </div>
  );
}
