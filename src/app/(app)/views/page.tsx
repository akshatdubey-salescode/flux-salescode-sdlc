import Link from "next/link";
import { requireAuth } from "@/lib/auth/server";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { RiUserStarLine } from "@remixicon/react";

const VIEWS = [
  {
    href: "/views/top-unplanned-assignees",
    icon: RiUserStarLine,
    title: "Top Assignees with Unplanned Tasks",
    description:
      "Ranks people by the number of issues they own that are missing a start or due date, filterable by quarter or custom date range.",
  },
];

export default async function ViewsPage() {
  await requireAuth();

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Views</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <main className="flex-1 p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Views</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Cross-cutting reports and aggregations over your Jira data.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {VIEWS.map(({ href, icon: Icon, title, description }) => (
              <Link
                key={href}
                href={href}
                className="group flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition-all hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 group-hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:group-hover:bg-zinc-700 transition-colors">
                    <Icon className="size-4" />
                  </div>
                  <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                    {title}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  {description}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
