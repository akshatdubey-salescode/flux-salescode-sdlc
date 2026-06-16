import { asc } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbLink,
} from "@/components/ui/breadcrumb";
import {
  FreshdeskIntegrationPanel,
  type FreshdeskProjectRow,
} from "@/components/superuser/freshdesk-integration-panel";

export default async function FreshdeskIntegrationPage() {
  await requireRole("SUPERUSER");

  const projects = await db
    .select({
      id: jiraProjects.id,
      name: jiraProjects.name,
      jiraProjectKey: jiraProjects.jiraProjectKey,
      freshdeskCompanyId: jiraProjects.freshdeskCompanyId,
      webhookSecret: jiraProjects.webhookSecret,
    })
    .from(jiraProjects)
    .orderBy(asc(jiraProjects.name));

  // Build the per-project webhook URL (secret included) so superusers can paste
  // it straight into a Freshdesk automation rule. NEXT_PUBLIC_APP_URL is the
  // canonical public origin for this deployment.
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");

  const rows: FreshdeskProjectRow[] = projects.map((p) => {
    // Decrypt per-row defensively — one malformed secret shouldn't 500 the page.
    let webhookUrl = "";
    try {
      webhookUrl = `${appUrl}/api/webhooks/freshdesk/${p.id}?secret=${decrypt(p.webhookSecret)}`;
    } catch {
      webhookUrl = "";
    }
    return {
      id: p.id,
      name: p.name,
      jiraProjectKey: p.jiraProjectKey,
      freshdeskCompanyId: p.freshdeskCompanyId,
      webhookUrl,
    };
  });

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
              <BreadcrumbPage>Freshdesk Integration</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Freshdesk Integration</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Enable Client Issue Tracking for any project by mapping it to a
              Freshdesk company. Once mapped, the project gets a Client Issue
              Tracker tab, the manual sync, and live webhook updates.
            </p>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <p className="font-medium text-zinc-700 dark:text-zinc-300">How it works</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              <li>
                Find the company&apos;s numeric ID in Freshdesk
                (Admin → Customers → Companies, or the company API).
              </li>
              <li>Paste it below and save — the Client Issue Tracker tab turns on immediately.</li>
              <li>Click <span className="font-medium">Sync now</span> on the project tab to pull historical tickets.</li>
              <li>
                For live updates, copy the project&apos;s webhook URL and add it to a
                Freshdesk automation rule (same ticket-field payload CavinKare uses).
              </li>
            </ol>
          </div>

          <FreshdeskIntegrationPanel projects={rows} />
        </div>
      </main>
    </div>
  );
}
