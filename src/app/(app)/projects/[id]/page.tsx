import { notFound } from "next/navigation";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects, jiraIssues } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { SidebarTrigger } from "@/components/ui/sidebar";

const PAGE_SIZE = 50;

type StatusCategory = "To Do" | "In Progress" | "Done" | string;

function statusCategoryColor(cat: StatusCategory | null) {
  if (cat === "Done" || cat === "Complete")
    return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
  if (cat === "In Progress")
    return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
  return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
}

export default async function ProjectPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  await requireAuth();
  const { id } = await props.params;
  const { page: pageStr, q } = await props.searchParams;

  const page = Math.max(1, parseInt(pageStr ?? "1", 10));
  const offset = (page - 1) * PAGE_SIZE;

  const [project] = await db
    .select()
    .from(jiraProjects)
    .where(and(eq(jiraProjects.id, id), eq(jiraProjects.isActive, true)))
    .limit(1);

  if (!project) notFound();

  // Build base conditions
  const baseConditions = [eq(jiraIssues.projectId, id)];

  const issues = await db
    .select({
      id: jiraIssues.id,
      jiraKey: jiraIssues.jiraKey,
      summary: jiraIssues.summary,
      status: jiraIssues.status,
      statusCategory: jiraIssues.statusCategory,
      issueType: jiraIssues.issueType,
      priority: jiraIssues.priority,
      assigneeName: jiraIssues.assigneeName,
      jiraUpdatedAt: jiraIssues.jiraUpdatedAt,
    })
    .from(jiraIssues)
    .where(and(...baseConditions))
    .orderBy(desc(jiraIssues.jiraUpdatedAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(jiraIssues)
    .where(and(...baseConditions));

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Status breakdown for quick stats
  const statusBreakdown = await db
    .select({
      statusCategory: jiraIssues.statusCategory,
      count: sql<number>`count(*)::int`,
    })
    .from(jiraIssues)
    .where(eq(jiraIssues.projectId, id))
    .groupBy(jiraIssues.statusCategory);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const webhookUrl = `${appUrl}/api/webhooks/jira/${project.id}?secret=${project.webhookSecret}`;

  return (
    <div className="flex flex-col min-h-svh">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <span className="text-sm text-zinc-500">Projects</span>
        <span className="text-sm text-zinc-300 dark:text-zinc-600">/</span>
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {project.name}
        </span>
        <span className="ml-1 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          {project.jiraProjectKey}
        </span>
      </header>

      <main className="flex-1 p-6 space-y-6">
        {/* Stats row */}
        <div className="flex flex-wrap gap-3">
          {statusBreakdown.map((s) => (
            <div
              key={s.statusCategory ?? "unknown"}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${statusCategoryColor(s.statusCategory)}`}
            >
              <span>{s.statusCategory ?? "Unknown"}</span>
              <span className="font-bold">{s.count}</span>
            </div>
          ))}
          <div className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            <span>Total</span>
            <span className="font-bold">{total}</span>
          </div>
        </div>

        {/* Issues table */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500">
                  Key
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500">
                  Summary
                </th>
                <th className="hidden px-4 py-2 text-left text-xs font-medium text-zinc-500 sm:table-cell">
                  Status
                </th>
                <th className="hidden px-4 py-2 text-left text-xs font-medium text-zinc-500 md:table-cell">
                  Assignee
                </th>
                <th className="hidden px-4 py-2 text-right text-xs font-medium text-zinc-500 lg:table-cell">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {issues.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-xs text-zinc-500"
                  >
                    No issues found.
                  </td>
                </tr>
              )}
              {issues.map((issue) => (
                <tr
                  key={issue.id}
                  className="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                >
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="font-mono text-xs text-zinc-500">
                      {issue.jiraKey}
                    </span>
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    <p className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-50">
                      {issue.summary}
                    </p>
                    <p className="text-xs text-zinc-400">{issue.issueType}</p>
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusCategoryColor(issue.statusCategory)}`}
                    >
                      {issue.status}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-zinc-500 md:table-cell">
                    {issue.assigneeName ?? "—"}
                  </td>
                  <td className="hidden px-4 py-3 text-right text-xs text-zinc-400 lg:table-cell">
                    {issue.jiraUpdatedAt
                      ? formatRelative(issue.jiraUpdatedAt)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <PageLink href={`/projects/${id}?page=${page - 1}`}>
                  Previous
                </PageLink>
              )}
              {page < totalPages && (
                <PageLink href={`/projects/${id}?page=${page + 1}`}>
                  Next
                </PageLink>
              )}
            </div>
          </div>
        )}

        {/* Webhook setup */}
        <WebhookPanel url={webhookUrl} lastSyncedAt={project.lastSyncedAt} />
      </main>
    </div>
  );
}

function PageLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="rounded border border-zinc-200 px-2.5 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
    >
      {children}
    </a>
  );
}

function WebhookPanel({
  url,
  lastSyncedAt,
}: {
  url: string;
  lastSyncedAt: Date | null;
}) {
  return (
    <details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Webhook setup & sync info
      </summary>
      <div className="border-t border-zinc-200 px-4 py-3 space-y-3 dark:border-zinc-800">
        <div>
          <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Last synced
          </p>
          <p className="text-xs text-zinc-500">
            {lastSyncedAt ? lastSyncedAt.toISOString() : "Never"}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Jira webhook URL
          </p>
          <p className="mt-1 break-all rounded bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            {url}
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            In Jira: Project settings → Integrations → Webhooks → Create
            webhook. Paste this URL and enable Issue + Comment events.
          </p>
        </div>
      </div>
    </details>
  );
}

function formatRelative(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
