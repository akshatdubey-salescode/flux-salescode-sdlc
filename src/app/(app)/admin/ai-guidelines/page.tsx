import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/server";
import { FEATURE_FLAGS, isEnabled } from "@/lib/feature-flags";
import { isLlmConfigured } from "@/lib/llm/minimax";
import { PageHeader } from "@/components/page-header";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { AiGuidelinesLibrary } from "@/components/test-cases/ai-guidelines-library";

export default async function AiGuidelinesPage() {
  await requireRole("ADMIN");
  if (!(await isEnabled(FEATURE_FLAGS.TEST_CASES))) notFound();
  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Test cases: Google access, AI status and guidelines</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>
      <main className="flex-1">
        <AiGuidelinesLibrary aiConfigured={isLlmConfigured()} />
      </main>
    </div>
  );
}
