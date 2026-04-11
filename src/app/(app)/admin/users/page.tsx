import { asc, count, ilike, sql } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { UserManagementTable } from "@/components/user-management-table";
import type { UserRole } from "@/lib/auth/types";

const PAGE_SIZE = 20;

export default async function UserManagementPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const actor = await requireRole("SUPERUSER");
  const searchParams = await props.searchParams;

  const q = typeof searchParams.q === "string" ? searchParams.q.trim() : "";
  const page = Math.max(1, parseInt((searchParams.page as string) ?? "1", 10) || 1);

  const whereClause = q ? ilike(users.email, `%${q}%`) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(users)
    .where(whereClause);

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(whereClause)
    .orderBy(asc(users.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return (
    <div className="flex flex-col min-h-svh">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>User Management</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <main className="flex-1 p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            User Management
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Manage roles for all users. Changes are applied on save.
          </p>
        </div>

        <UserManagementTable
          users={rows.map((u) => ({ ...u, role: u.role as UserRole }))}
          currentUserId={actor.id}
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          search={q}
        />
      </main>
    </div>
  );
}
