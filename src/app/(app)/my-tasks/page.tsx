import { Suspense } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { MyTasksView } from "@/components/my-tasks";

export default function MyTasksPage() {
  return (
    <div className="flex flex-col min-h-svh">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>My Tasks</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <main className="flex-1 p-6">
        <Suspense fallback={<MyTasksLoading />}>
          <MyTasksView />
        </Suspense>
      </main>
    </div>
  );
}

function MyTasksLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-10 w-full bg-zinc-100 rounded-md dark:bg-zinc-800" />
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <div className="h-10 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800" />
        <div className="p-4 space-y-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-4 bg-zinc-100 dark:bg-zinc-800 rounded w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

