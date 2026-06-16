import { Suspense } from "react";
import { requireAuth } from "@/lib/auth/server";
import { PageHeader } from "@/components/page-header";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { SearchView } from "@/components/global-search";

export default async function SearchPage() {
  await requireAuth();

  return (
    <div className="flex flex-col min-h-svh">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Search</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />}>
          <SearchView />
        </Suspense>
      </main>
    </div>
  );
}
