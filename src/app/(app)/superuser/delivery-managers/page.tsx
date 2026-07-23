import { ilike, or, asc, eq, count } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { users, kekaEmployees } from "@/lib/db/schema";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { DeliveryManagersTable } from "@/components/delivery-managers-table";

const PAGE_SIZE = 50;

export default async function DeliveryManagersPage(props: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireRole("SUPERUSER");
  const { q, page: pageParam } = await props.searchParams;
  const query = (q ?? "").trim();
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const whereClause = query
    ? or(ilike(users.email, `%${query}%`), ilike(kekaEmployees.displayName, `%${query}%`))
    : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(users)
    .leftJoin(kekaEmployees, eq(kekaEmployees.email, users.id))
    .where(whereClause);

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      canManageDeliveries: users.canManageDeliveries,
      name: kekaEmployees.displayName,
    })
    .from(users)
    .leftJoin(kekaEmployees, eq(kekaEmployees.email, users.id))
    .where(whereClause)
    .orderBy(asc(users.email))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return (
    <div className="flex flex-col min-h-svh">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Delivery Access</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Delivery Access
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Grant or revoke who beyond Admins can create and manage delivery trackers. Admins always have this
            access regardless of this setting.
          </p>
        </div>

        <DeliveryManagersTable
          key={`${query}-${page}`}
          users={rows.map((u) => ({ ...u, name: u.name ?? null }))}
          search={query}
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
        />
      </main>
    </div>
  );
}
