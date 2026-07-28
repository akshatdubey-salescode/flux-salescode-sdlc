import { and, asc, eq } from "drizzle-orm";
import Image from "next/image";
import { PageHeader } from "@/components/page-header";
import { requireAuth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { jiraProjects, userIntegrations } from "@/lib/db/schema";
import { getValidCredentials } from "@/lib/atlassian/oauth";
import { CreateJiraForm } from "./create-jira-form";

export default async function CreateJiraPage() {
  const user = await requireAuth();

  const [projects, [integration]] = await Promise.all([
    db
      .select({
        id: jiraProjects.id,
        name: jiraProjects.name,
        key: jiraProjects.jiraProjectKey,
      })
      .from(jiraProjects)
      .where(eq(jiraProjects.isActive, true))
      .orderBy(asc(jiraProjects.name)),
    db
      .select({
        email: userIntegrations.atlassianEmail,
        accountId: userIntegrations.atlassianAccountId,
        cloudId: userIntegrations.atlassianCloudId,
      })
      .from(userIntegrations)
      .where(
        and(
          eq(userIntegrations.userId, user.id),
          eq(userIntegrations.provider, "atlassian")
        )
      )
      .limit(1),
  ]);

  const credentials = integration
    ? await getValidCredentials(user.id)
    : null;
  const connected = Boolean(integration?.email && credentials);

  return (
    <div className="flex min-h-svh flex-col bg-zinc-50/60 dark:bg-zinc-950/30">
      <PageHeader className="bg-background/80 backdrop-blur-xl">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">My work</span>
          <span className="text-muted-foreground/40">/</span>
          <span className="font-medium text-foreground">Create Jira</span>
        </div>
      </PageHeader>

      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-10">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-start gap-3.5">
              <Image
                src="/jira-icon.png"
                alt="Jira"
                width={40}
                height={40}
                className="size-10 shrink-0 rounded-xl"
                loading="eager"
              />
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                  Create Jira
                </h1>
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                  Turn an idea into actionable work—without leaving Flux.
                </p>
              </div>
            </div>

            <div className="ml-[3.375rem] inline-flex w-fit items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] font-medium text-muted-foreground sm:ml-0">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Fast create
            </div>
          </div>

          <CreateJiraForm
            connected={connected}
            connectionExpired={Boolean(integration && !credentials)}
            connectedEmail={integration?.email ?? null}
            projects={projects}
          />
        </div>
      </main>
    </div>
  );
}
