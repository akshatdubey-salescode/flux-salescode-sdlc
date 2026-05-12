"use client";

import { Suspense, use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbLink,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { MyTasksView } from "@/components/my-tasks";
import { AssigneePicker } from "@/components/my-tasks/assignee-picker";
import { RiArrowLeftLine, RiUserSearchLine } from "@remixicon/react";

type Props = {
  params: Promise<{ email: string }>;
};

export default function UserTasksPage({ params }: Props) {
  const { email } = use(params);
  const decodedEmail = decodeURIComponent(email);
  const displayName = decodedEmail.split("@")[0];
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="flex flex-col min-h-svh">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/my-tasks">My Tasks</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{displayName}&apos;s Tasks</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 gap-1.5 h-7 px-2"
          >
            <RiArrowLeftLine className="size-3.5" />
            Go back
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPickerOpen(true)}
            className="text-xs gap-1.5 h-7 px-2.5"
          >
            <RiUserSearchLine className="size-3.5" />
            Check someone else&apos;s tasks
          </Button>
        </div>
      </header>

      <main className="flex-1 p-6">
        <Suspense fallback={<TasksLoading />}>
          <MyTasksView targetEmail={decodedEmail} />
        </Suspense>
      </main>

      <AssigneePicker open={pickerOpen} onOpenChange={setPickerOpen} />
    </div>
  );
}

function TasksLoading() {
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
