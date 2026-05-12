import Link from "next/link";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export default function ProjectNotFound() {
  return (
    <div className="flex flex-col min-h-svh min-w-0 w-full">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/projects">Projects</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Not found</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Project not found
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            This project does not exist or has been deactivated.
          </p>
        </div>
        <Link
          href="/projects"
          className="text-sm font-medium text-zinc-900 underline underline-offset-4 hover:text-zinc-600 dark:text-zinc-50 dark:hover:text-zinc-300"
        >
          Back to projects
        </Link>
      </main>
    </div>
  );
}
