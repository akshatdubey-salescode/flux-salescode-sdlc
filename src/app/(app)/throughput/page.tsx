import { sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { ThroughputLeaderboard } from "@/components/analytics/throughput-leaderboard";

export default async function ThroughputPage() {
  await requireAuth();

  // Global people pool for the optional focus filter: every assignee across
  // active projects, plus all observer board members.
  const peopleRes = await db.execute(sql`
    SELECT email, name FROM (
      SELECT lower(ji.assignee_email) AS email, MIN(ji.assignee_name) AS name
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id AND jp.is_active = true
      WHERE ji.assignee_email IS NOT NULL AND ji.assignee_email <> ''
      GROUP BY lower(ji.assignee_email)
      UNION
      SELECT lower(email) AS email, name FROM observer_board_members
    ) t
    ORDER BY name
  `);

  const peopleMap = new Map<string, string>();
  for (const r of peopleRes.rows as { email: string; name: string | null }[]) {
    if (!r.email) continue;
    const name = r.name?.trim() || r.email.split("@")[0];
    if (!peopleMap.has(r.email)) peopleMap.set(r.email, name);
  }
  const people = [...peopleMap.entries()]
    .map(([email, name]) => ({ email, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col min-h-svh">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Throughput</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <main className="flex-1 p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Throughput
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              How many Jira issues each person closed over a period. An issue counts
              once per person who held it — primary and additional assignees alike.
            </p>
          </div>

          <ThroughputLeaderboard people={people} />
        </div>
      </main>
    </div>
  );
}
