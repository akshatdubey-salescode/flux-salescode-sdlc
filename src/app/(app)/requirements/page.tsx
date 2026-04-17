import Link from "next/link";
import { desc, asc, eq, and, ilike, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { requirements } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { RiSparklingLine, RiAddLine } from "@remixicon/react";
import { RequirementsList } from "./requirements-list";

export default async function RequirementsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAuth();
  const searchParams = await props.searchParams;

  const q = typeof searchParams.q === "string" ? searchParams.q.trim() : "";
  const statusFilter = typeof searchParams.status === "string"
    ? searchParams.status.split(",").filter(Boolean)
    : [];
  const sortBy = typeof searchParams.sortBy === "string" ? searchParams.sortBy : "created";
  const sortDir = searchParams.sortDir === "asc" ? "asc" : "desc";

  const conditions = [eq(requirements.createdBy, user.id)];

  if (q) conditions.push(ilike(requirements.title, `%${q}%`));
  if (statusFilter.length) {
    conditions.push(
      inArray(requirements.status, statusFilter as ("draft" | "published")[])
    );
  }
  const orderCol = sortBy === "title" ? requirements.title : requirements.createdAt;

  const rows = await db
    .select({
      id: requirements.id,
      title: requirements.title,
      status: requirements.status,
      createdAt: requirements.createdAt,
    })
    .from(requirements)
    .where(and(...conditions))
    .orderBy(sortDir === "asc" ? asc(orderCol) : desc(orderCol));

  return (
    <div className="flex flex-col min-h-svh">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Requirements</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <Link
          href="/requirements/new"
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <RiAddLine size={14} />
          New Requirement
        </Link>
      </header>

      <main className="flex-1 p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Requirements
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              AI-generated requirements built with Charjan for your developers.
            </p>
          </div>
        </div>

        <RequirementsList rows={rows} total={rows.length} />
      </main>
    </div>
  );
}
