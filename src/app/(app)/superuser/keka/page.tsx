import { asc, isNull, sql } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { kekaEmployees, users } from "@/lib/db/schema";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { KekaManager, type KekaEmployeeRow } from "./keka-manager";

export default async function KekaPage() {
  await requireRole("SUPERUSER");

  const [counts] = await db
    .select({
      total: sql<number>`cast(count(*) as int)`,
      linked: sql<number>`cast(count(*) filter (where ${kekaEmployees.userId} is not null) as int)`,
    })
    .from(kekaEmployees);

  const total = counts?.total ?? 0;
  const linked = counts?.linked ?? 0;

  // Employees we couldn't auto-link by email — the superuser maps these by hand.
  const unlinked: KekaEmployeeRow[] = await db
    .select({
      kekaEmployeeId: kekaEmployees.kekaEmployeeId,
      employeeNumber: kekaEmployees.employeeNumber,
      displayName: kekaEmployees.displayName,
      email: kekaEmployees.email,
      jobTitle: kekaEmployees.jobTitle,
      managerName: kekaEmployees.managerName,
      employmentStatusLabel: kekaEmployees.employmentStatusLabel,
    })
    .from(kekaEmployees)
    .where(isNull(kekaEmployees.userId))
    .orderBy(asc(kekaEmployees.displayName));

  const userOptions = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .orderBy(asc(users.email));

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
              <BreadcrumbPage>Keka HR</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Keka HR</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Sync the Keka employee directory into Flux and map employees that
              couldn&apos;t be auto-linked to a user by email. The first ever
              population is best run via{" "}
              <span className="font-mono text-xs">pnpm sync:keka</span> (no
              serverless time limit).
            </p>
          </div>

          <KekaManager
            counts={{ total, linked, unlinked: total - linked }}
            unlinked={unlinked}
            users={userOptions}
          />
        </div>
      </main>
    </div>
  );
}
