import Link from "next/link";
import { requireAuth } from "@/lib/auth/server";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { OrgDashboard } from "@/components/dashboard/org-dashboard";

export default async function HomePage() {
  const user = await requireAuth();

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Organisation Dashboard</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <main className="flex-1 p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50 tracking-tight">
              Engineering Velocity
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Cross-project insights and performance metrics
            </p>
          </div>

          <OrgDashboard />
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-zinc-500">{label}</p>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
    >
      {label}
    </Link>
  );
}
