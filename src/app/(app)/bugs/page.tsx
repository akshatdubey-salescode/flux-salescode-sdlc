import { requireAuth } from "@/lib/auth/server";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { FEATURE_FLAGS, isEnabled } from "@/lib/feature-flags";
import { BugBoardClient } from "@/components/bugs/bug-board-client";

/**
 * Org-wide Bug Board: developer-wise bug counts across every project, defaulting
 * to the current fiscal quarter. RAG-coloured vs the team average, with % share,
 * customer-vs-QA + project-wise drill-downs, Jira deep-links, and a per-developer
 * link into their My Bugs view.
 */
export default async function BugBoardPage() {
  await requireAuth();

  // Off by default — a superuser flips feature_flags.showBugBoardOpenColumn
  // to bring it back, in the table and the Excel export both, without a
  // deploy. Single source of truth for both surfaces: BugBoardClient just
  // gets this one boolean.
  const showOpenColumn = await isEnabled(FEATURE_FLAGS.BUG_BOARD_OPEN_COLUMN);

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

      {/* pb-0 — matches the Performance Review leaderboard page's own main:
          the table is the last thing on the page, so its bottom border
          should be what a full scroll lands on, not 24px of empty page
          below it. */}
      <main className="flex-1 p-6 pb-0">
        <div className="mx-auto max-w-6xl">
          <BugBoardClient showOpenColumn={showOpenColumn} />
        </div>
      </main>
    </div>
  );
}
