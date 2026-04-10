import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects, jiraIssues } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { SidebarTrigger } from "@/components/ui/sidebar";

export default async function HomePage() {
  const user = await requireAuth();

  const [projectCount, issueCount] = await Promise.all([
    db.$count(jiraProjects, eq(jiraProjects.isActive, true)),
    db.$count(jiraIssues),
  ]);

  return (
    <div className="flex flex-col min-h-svh">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <span className="text-sm text-zinc-500">Dashboard</span>
      </header>

      <main className="flex-1 p-6">
        <div className="max-w-2xl space-y-6">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              Welcome back
            </h1>
            <p className="mt-0.5 text-sm text-zinc-500">{user.email}</p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatCard label="Projects" value={projectCount} />
            <StatCard label="Issues synced" value={issueCount} />
          </div>

          {/* Quick links */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Quick links
            </p>
            <div className="flex flex-wrap gap-2">
              <QuickLink href="/projects" label="All projects" />
              <QuickLink href="/my-tasks" label="My tasks" />
              <QuickLink href="/search" label="Search issues" />
              {user.role === "SUPERUSER" && (
                <QuickLink href="/projects/new" label="Add project" />
              )}
            </div>
          </div>
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
