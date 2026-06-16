import Link from "next/link";
import { requireAuth } from "@/lib/auth/server";
import { PageHeader } from "@/components/page-header";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { ExecutiveDashboard } from "@/components/dashboard/executive-dashboard";
import { RiBarChart2Line } from "@remixicon/react";

export default async function HomePage() {
  await requireAuth();

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      {/* Top bar */}
      <PageHeader className="bg-white dark:bg-zinc-900">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Organisation Dashboard</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50 tracking-tight">
                Engineering Overview
              </h1>
              <p className="mt-1 text-sm text-zinc-500">
                Org-wide delivery health, flow, and risk at a glance
              </p>
            </div>
            <Link
              href="/workload"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              <RiBarChart2Line className="size-3.5" />
              Workload detail
            </Link>
          </div>

          <ExecutiveDashboard />
        </div>
      </main>
    </div>
  );
}
