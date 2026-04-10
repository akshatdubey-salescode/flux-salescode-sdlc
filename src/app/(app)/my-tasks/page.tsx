import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraIssues } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { SidebarTrigger } from "@/components/ui/sidebar";

function statusCategoryColor(cat: string | null) {
  if (cat === "Done")
    return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
  if (cat === "In Progress")
    return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
  return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
}

export default async function MyTasksPage() {
  const user = await requireAuth();

  const issues = await db
    .select({
      id: jiraIssues.id,
      jiraKey: jiraIssues.jiraKey,
      summary: jiraIssues.summary,
      status: jiraIssues.status,
      statusCategory: jiraIssues.statusCategory,
      issueType: jiraIssues.issueType,
      priority: jiraIssues.priority,
      projectId: jiraIssues.projectId,
      jiraUpdatedAt: jiraIssues.jiraUpdatedAt,
    })
    .from(jiraIssues)
    .where(eq(jiraIssues.assigneeEmail, user.email))
    .orderBy(desc(jiraIssues.jiraUpdatedAt))
    .limit(100);

  return (
    <div className="flex flex-col min-h-svh">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <span className="text-sm text-zinc-500">My Tasks</span>
        <span className="ml-auto rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          {issues.length}
        </span>
      </header>

      <main className="flex-1 p-6">
        {issues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              No tasks assigned to you
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Issues assigned to {user.email} will appear here once synced.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500">Key</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500">Summary</th>
                  <th className="hidden px-4 py-2 text-left text-xs font-medium text-zinc-500 sm:table-cell">Status</th>
                  <th className="hidden px-4 py-2 text-right text-xs font-medium text-zinc-500 md:table-cell">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {issues.map((issue) => (
                  <tr
                    key={issue.id}
                    className="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                  >
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="font-mono text-xs text-zinc-500">{issue.jiraKey}</span>
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <p className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-50">{issue.summary}</p>
                      <p className="text-xs text-zinc-400">{issue.issueType}</p>
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusCategoryColor(issue.statusCategory)}`}>
                        {issue.status}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 text-right text-xs text-zinc-400 md:table-cell">
                      {issue.jiraUpdatedAt ? formatRelative(issue.jiraUpdatedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function formatRelative(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
