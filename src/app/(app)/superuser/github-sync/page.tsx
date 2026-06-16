import { requireRole } from "@/lib/auth/server";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/page-header";
import { GithubSyncPanel } from "@/components/superuser/github-sync-panel";

export default async function GithubSyncPage() {
  await requireRole("SUPERUSER");

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
              <BreadcrumbPage>GitHub Sync</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">GitHub Sync</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Refresh the repo mirror and pull per-author contributor stats that
              power the Lines of Code view. Normally runs on a daily cron; trigger
              it here on demand. The first ever population is best run via{" "}
              <span className="font-mono text-xs">pnpm sync:github</span> (no
              serverless time limit).
            </p>
          </div>
          <GithubSyncPanel />
        </div>
      </main>
    </div>
  );
}
