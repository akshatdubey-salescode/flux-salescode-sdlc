import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";

export default function ProjectsLoading() {
  return (
    <div className="flex flex-col min-h-svh">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Projects</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">All Projects</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Manage your synced Jira projects and workspaces.</p>
          </div>
          <div className="flex items-center gap-4 flex-1 justify-end">
            <Skeleton className="h-10 w-full max-w-[300px] rounded-md" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col overflow-hidden rounded-xl border border-zinc-200/60 bg-white dark:border-zinc-800/60 dark:bg-zinc-950 h-[240px]"
            >
              {/* Banner Skeleton */}
              <div className="relative h-32 w-full bg-zinc-100 dark:bg-zinc-900 animate-pulse">
                <div className="absolute bottom-3 left-4 z-10">
                  <Skeleton className="h-7 w-14 rounded-md bg-white/40 dark:bg-black/30" />
                </div>
              </div>

              {/* Content Section Skeleton */}
              <div className="flex flex-1 flex-col p-4 bg-gradient-to-b from-white to-zinc-50/50 dark:from-zinc-950 dark:to-zinc-950/80">
                <div className="space-y-2 mb-3">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                
                <div className="mt-auto pt-4 flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800/60">
                  <div className="flex items-center gap-1.5">
                    <Skeleton className="h-6 w-6 rounded-full" />
                    <div className="flex flex-col gap-1">
                      <Skeleton className="h-2 w-8" />
                      <Skeleton className="h-3 w-6" />
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Skeleton className="h-2 w-10" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
