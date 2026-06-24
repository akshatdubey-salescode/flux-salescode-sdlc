import Link from "next/link";
import { requireRole } from "@/lib/auth/server";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { RiFlag2Line, RiRefreshLine, RiLightbulbLine, RiDeleteBin2Line, RiCalendarLine, RiCustomerService2Line, RiArrowLeftRightLine, RiGithubLine, RiGitMergeLine, RiGitBranchLine, RiBuilding2Line, RiMegaphoneLine, RiTeamLine } from "@remixicon/react";

const TOOLS = [
  {
    href: "/superuser/release-notes",
    icon: RiMegaphoneLine,
    title: "What's New",
    description: "Author release notes that appear in every user's notification bell. Alerts also pop up as a modal once.",
  },
  {
    href: "/superuser/github-orgs",
    icon: RiBuilding2Line,
    title: "GitHub Orgs",
    description: "Add or remove GitHub organisations (each with its own token) that feed the Lines of Code view.",
  },
  {
    href: "/superuser/github-sync",
    icon: RiGithubLine,
    title: "GitHub Sync",
    description: "Refresh repos and pull per-author contributor stats for the Lines of Code view. Runs daily on a cron; trigger on demand here.",
  },
  {
    href: "/superuser/github-accounts",
    icon: RiGitMergeLine,
    title: "GitHub Accounts",
    description: "Map GitHub accounts that couldn't be auto-matched by email to their person, so their lines of code are attributed.",
  },
  {
    href: "/superuser/github-repos",
    icon: RiGitBranchLine,
    title: "Repo Branches",
    description: "Count extra branches (beyond the default) in a repo's Lines of Code. Shared commits are deduped, so nothing is double-counted.",
  },
  {
    href: "/superuser/feature-flags",
    icon: RiFlag2Line,
    title: "Feature Flags",
    description: "Toggle features on or off at runtime without a code deploy.",
  },
  {
    href: "/superuser/sync-all",
    icon: RiRefreshLine,
    title: "Sync Projects",
    description: "Force-sync all active Jira projects and monitor progress in real time.",
  },
  {
    href: "/superuser/feature-requests",
    icon: RiLightbulbLine,
    title: "Feature Requests",
    description: "View all feature requests submitted by users across the platform.",
  },
  {
    href: "/superuser/calendar-sync",
    icon: RiCalendarLine,
    title: "Calendar Sync",
    description: "Manually trigger the Google Calendar sync that normally runs on a cron schedule.",
  },
  {
    href: "/superuser/freshdesk",
    icon: RiCustomerService2Line,
    title: "Freshdesk Integration",
    description: "Enable Client Issue Tracking for any project by mapping it to a Freshdesk company.",
  },
  {
    href: "/superuser/keka",
    icon: RiTeamLine,
    title: "Keka HR",
    description: "Sync the Keka employee directory and map employees that couldn't be auto-linked to a user by email.",
  },
  {
    href: "/superuser/unmapped-projects",
    icon: RiArrowLeftRightLine,
    title: "Unmapped Projects",
    description: "List active projects that have no canonical status mapping configured yet.",
  },
  {
    href: "/superuser/delete-project",
    icon: RiDeleteBin2Line,
    title: "Delete Project",
    description: "Permanently remove a project and all associated data — issues, SLAs, sync history, and more.",
    danger: true,
  },
];

export default async function SuperuserPage() {
  await requireRole("SUPERUSER");

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Superuser</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Superuser Tools</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Administrative controls for managing the platform.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {TOOLS.map(({ href, icon: Icon, title, description, danger }) => (
              <Link
                key={href}
                href={href}
                className={`group flex flex-col gap-3 rounded-xl border bg-white p-5 shadow-sm transition-all dark:bg-zinc-900 ${
                  danger
                    ? "border-red-200 hover:border-red-300 hover:shadow-md dark:border-red-900/50 dark:hover:border-red-800/60"
                    : "border-zinc-200 hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex size-9 items-center justify-center rounded-lg transition-colors ${
                      danger
                        ? "bg-red-50 text-red-600 group-hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:group-hover:bg-red-950/50"
                        : "bg-zinc-100 text-zinc-600 group-hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:group-hover:bg-zinc-700"
                    }`}
                  >
                    <Icon className="size-4" />
                  </div>
                  <span
                    className={`font-semibold text-sm ${
                      danger
                        ? "text-red-700 dark:text-red-400"
                        : "text-zinc-900 dark:text-zinc-100"
                    }`}
                  >
                    {title}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  {description}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
