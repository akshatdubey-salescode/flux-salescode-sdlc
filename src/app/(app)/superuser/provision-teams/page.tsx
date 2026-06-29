import Link from "next/link";
import { desc } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { observerBoardProvisionRuns } from "@/lib/db/schema";
import { buildProvisionProposal } from "@/lib/observer/provisioning";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ProvisionTeamsClient, type ProvisionRunRow } from "./provision-teams-client";

export default async function ProvisionTeamsPage() {
  await requireRole("SUPERUSER");

  const proposal = await buildProvisionProposal();

  const runRows = await db
    .select({
      id: observerBoardProvisionRuns.id,
      triggeredBy: observerBoardProvisionRuns.triggeredBy,
      status: observerBoardProvisionRuns.status,
      boardsCreated: observerBoardProvisionRuns.boardsCreated,
      membersCreated: observerBoardProvisionRuns.membersCreated,
      createdAt: observerBoardProvisionRuns.createdAt,
      rolledBackAt: observerBoardProvisionRuns.rolledBackAt,
    })
    .from(observerBoardProvisionRuns)
    .orderBy(desc(observerBoardProvisionRuns.createdAt))
    .limit(25);

  const runs: ProvisionRunRow[] = runRows.map((r) => ({
    id: r.id,
    triggeredBy: r.triggeredBy,
    status: r.status as "active" | "rolled_back",
    boardsCreated: r.boardsCreated,
    membersCreated: r.membersCreated,
    createdAt: r.createdAt.toISOString(),
    rolledBackAt: r.rolledBackAt ? r.rolledBackAt.toISOString() : null,
  }));

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
              <BreadcrumbPage>Provision Teams</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Provision Teams</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Bulk-create Team Pulse boards from the Keka org hierarchy — one board
              per manager, seeded with their direct reports. Review and edit the
              proposal below, then provision. Nothing is written until you confirm,
              managers who already have a board are skipped, and every run is fully
              reversible. The proposal reads the last{" "}
              <Link href="/superuser/keka" className="underline hover:text-zinc-700 dark:hover:text-zinc-300">
                Keka sync
              </Link>
              — sync there first if it looks stale.
            </p>
          </div>

          <ProvisionTeamsClient proposal={proposal} runs={runs} />
        </div>
      </main>
    </div>
  );
}
