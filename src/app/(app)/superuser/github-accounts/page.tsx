import { asc, sql } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { AccountMapper, type UnmappedAccount } from "./account-mapper";

export default async function GithubAccountsPage() {
  await requireRole("SUPERUSER");

  // Unmapped, non-bot accounts with their tracked-repo totals so the highest
  // contributors (most worth mapping) surface first.
  const accountsRes = await db.execute(sql`
    SELECT
      ga.github_login AS login,
      ga.display_name AS name,
      ga.avatar_url AS avatar,
      COALESCE(s.net, 0)::int AS net,
      COALESCE(s.commits, 0)::int AS commits
    FROM github_accounts ga
    LEFT JOIN (
      SELECT gcs.github_login,
        SUM(gcs.additions - gcs.deletions) AS net,
        SUM(gcs.commits) AS commits
      FROM github_contributor_stats gcs
      JOIN github_repos gr ON gr.id = gcs.repo_id AND gr.is_tracked = true
      GROUP BY gcs.github_login
    ) s ON s.github_login = ga.github_login
    WHERE ga.user_id IS NULL AND ga.is_bot = false
    ORDER BY net DESC NULLS LAST, ga.github_login ASC
  `);
  const accounts = accountsRes.rows as UnmappedAccount[];

  const userOptions = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .orderBy(asc(users.email));

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/superuser">Superuser</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>GitHub Accounts</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <main className="flex-1 p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">GitHub Accounts</h1>
            <p className="text-sm text-zinc-500 mt-1">
              GitHub accounts that couldn&apos;t be auto-matched to a person by
              email. Map each to a user so their contributions count toward the
              Lines of Code view. Bot accounts are hidden.
            </p>
          </div>

          {accounts.length > 0 && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {accounts.length} unmapped account{accounts.length === 1 ? "" : "s"},
              highest contributors first.
            </p>
          )}

          <AccountMapper accounts={accounts} users={userOptions} />
        </div>
      </main>
    </div>
  );
}
