import type { NextRequest } from "next/server";
import { ilike, or, desc, sql, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraIssues } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb";

function statusCategoryColor(cat: string | null) {
  if (cat === "Done" || cat === "Complete")
    return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
  if (cat === "In Progress")
    return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
  return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
}

export default async function SearchPage(props: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAuth();
  const { q } = await props.searchParams;
  const query = q?.trim() ?? "";

  let issues: {
    id: string;
    jiraKey: string;
    summary: string;
    status: string;
    statusCategory: string | null;
    issueType: string;
    assigneeName: string | null;
    jiraUpdatedAt: Date | null;
  }[] = [];

  if (query.length > 1) {
    issues = await db
      .select({
        id: jiraIssues.id,
        jiraKey: jiraIssues.jiraKey,
        summary: jiraIssues.summary,
        status: jiraIssues.status,
        statusCategory: jiraIssues.statusCategory,
        issueType: jiraIssues.issueType,
        assigneeName: jiraIssues.assigneeName,
        jiraUpdatedAt: jiraIssues.jiraUpdatedAt,
      })
      .from(jiraIssues)
      .where(
        or(
          ilike(jiraIssues.jiraKey, `%${query}%`),
          ilike(jiraIssues.summary, `%${query}%`)
        )
      )
      .orderBy(desc(jiraIssues.jiraUpdatedAt))
      .limit(50);
  }

  return (
    <div className="flex flex-col min-h-svh">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Search</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <main className="flex-1 p-6 space-y-4">
        {/* Search form — GET method so query is in URL */}
        <form method="GET" className="flex gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="Search by key or summary…"
            autoFocus
            className="flex h-9 flex-1 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus-visible:ring-zinc-300"
          />
          <button
            type="submit"
            className="inline-flex h-9 items-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Search
          </button>
        </form>

        {query.length > 1 && (
          <p className="text-xs text-zinc-500">
            {issues.length === 0
              ? "No results."
              : `${issues.length} result${issues.length === 1 ? "" : "s"} for "${query}"`}
          </p>
        )}

        {issues.length > 0 && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500">Key</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500">Summary</th>
                  <th className="hidden px-4 py-2 text-left text-xs font-medium text-zinc-500 sm:table-cell">Status</th>
                  <th className="hidden px-4 py-2 text-left text-xs font-medium text-zinc-500 md:table-cell">Assignee</th>
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
                    <td className="hidden px-4 py-3 text-xs text-zinc-500 md:table-cell">
                      {issue.assigneeName ?? "—"}
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
