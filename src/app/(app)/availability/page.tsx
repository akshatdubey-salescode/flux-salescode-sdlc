import { asc, eq, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { jiraProjects, observerBoards } from "@/lib/db/schema";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { AvailabilityFinder } from "@/components/availability/availability-finder";

export default async function AvailabilityPage() {
  await requireAuth();

  const [projects, boards, peopleRes] = await Promise.all([
    db
      .select({ id: jiraProjects.id, name: jiraProjects.name })
      .from(jiraProjects)
      .where(eq(jiraProjects.isActive, true))
      .orderBy(asc(jiraProjects.name)),
    db
      .select({
        id: observerBoards.id,
        name: observerBoards.name,
        managerEmail: observerBoards.managerEmail,
      })
      .from(observerBoards)
      .orderBy(asc(observerBoards.name)),
    db.execute(sql`
      -- Every current Keka employee is the pool, full stop: the people who may be
      -- picked are the people who work here, not the people Jira happens to have a
      -- row for. Jira's assignee name is only a fallback when Keka has no display
      -- name. See src/lib/keka/people.ts for why the old
      -- assignees-UNION-board-members pool was wrong: it offered ex-employees,
      -- client reporters and Atlassian service accounts as pickable people.
      SELECT ke.email AS email,
             COALESCE(
               NULLIF(ke.display_name, ''),
               (SELECT MIN(ji.assignee_name) FROM jira_issues ji
                WHERE lower(ji.assignee_email) = ke.email),
               split_part(ke.email, '@', 1)
             ) AS name
      FROM keka_employees ke
      WHERE ke.email IS NOT NULL
      ORDER BY name
    `),
  ]);

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
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Availability Finder</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Availability Finder
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Everyone&apos;s next free date across the org, shown by default —
              narrow by project, team, or person below. Availability is global:
              it counts every open, dated task a person holds across all
              projects.
            </p>
          </div>

          <AvailabilityFinder projects={projects} boards={boards} people={people} />
        </div>
      </main>
    </div>
  );
}
