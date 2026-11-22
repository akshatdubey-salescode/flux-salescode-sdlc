import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";

export default function MovementNotFound() {
  return (
    <div className="flex flex-col min-h-svh min-w-0 w-full">
      <PageHeader>
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
      </PageHeader>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Movement not found</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">This movement, its delivery or its project does not exist, was deleted, or has been deactivated.</p>
        </div>
        <Link href="/projects" className="text-sm font-medium text-zinc-900 underline underline-offset-4 hover:text-zinc-600 dark:text-zinc-50 dark:hover:text-zinc-300">
          Back to projects
        </Link>
      </div>
    </div>
  );
}
