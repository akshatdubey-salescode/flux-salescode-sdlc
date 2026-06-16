import { requireRole } from "@/lib/auth/server";
import { listFlags } from "@/lib/feature-flags";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { FeatureFlagsPanel } from "@/components/superuser/feature-flags-panel";

export default async function FeatureFlagsPage() {
  await requireRole("SUPERUSER");
  const flags = await listFlags();

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Feature Flags</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Feature Flags</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Toggle features on or off at runtime. Changes take effect after the cache is
              revalidated.
            </p>
          </div>
          <FeatureFlagsPanel flags={flags} />
        </div>
      </main>
    </div>
  );
}
