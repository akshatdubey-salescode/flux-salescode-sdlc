"use client";

import { Suspense, useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { MyTasksView } from "@/components/my-tasks";
import { AssigneePicker } from "@/components/my-tasks/assignee-picker";
import { RiUserSearchLine } from "@remixicon/react";

export default function MyTasksPage() {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="flex flex-col min-h-svh">
      <PageHeader
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPickerOpen(true)}
            className="text-xs gap-1.5 h-7 px-2.5"
          >
            <RiUserSearchLine className="size-3.5" />
            Curious about someone else&apos;s bandwidth?
          </Button>
        }
      >
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>My Tasks</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <Suspense fallback={<MyTasksLoading />}>
          <MyTasksView />
        </Suspense>
      </main>

      <AssigneePicker open={pickerOpen} onOpenChange={setPickerOpen} />
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
