import { requireRole } from "@/lib/auth/server";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { ScheduledEmailsPanel } from "@/components/superuser/scheduled-emails-panel";

export default async function ScheduledEmailsPage() {
  await requireRole("SUPERUSER");

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Scheduled Emails</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Scheduled Emails</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Every standing schedule in Flux, with its next run and whether the last one actually
              went out. Sends happen at midnight IST; a schedule stops itself once its sprint — or
              every sprint in its workstream — has finished. Pause, send early, or delete any of
              them here.
            </p>
          </div>
          <ScheduledEmailsPanel />
        </div>
      </main>
    </div>
  );
}
