import { requireAuth } from "@/lib/auth/server";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { BugBoardClient } from "@/components/bugs/bug-board-client";

/**
 * Org-wide Bug Board: developer-wise bug counts across every project, defaulting
 * to the current fiscal quarter. RAG-coloured vs the team average, with % share,
 * customer-vs-QA + project-wise drill-downs, Jira deep-links, and a per-developer
 * link into their My Bugs view.
 */
export default async function BugBoardPage() {
  await requireAuth();

  return (
    <div className="flex flex-col min-h-svh">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Bug Board</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="mx-auto max-w-6xl">
          <BugBoardClient />
        </div>
      </main>
    </div>
  );
}
