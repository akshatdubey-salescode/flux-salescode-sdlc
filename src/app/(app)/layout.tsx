import { eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects, observerBoards } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { CommandPalette } from "@/components/command-palette";
import { isEnabled, FEATURE_FLAGS } from "@/lib/feature-flags";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuth();

  const [projects, teams, requirementBuilderEnabled] = await Promise.all([
    db
      .select({
        id: jiraProjects.id,
        name: jiraProjects.name,
        jiraProjectKey: jiraProjects.jiraProjectKey,
      })
      .from(jiraProjects)
      .where(eq(jiraProjects.isActive, true))
      .orderBy(asc(jiraProjects.name)),
    db
      .select({
        id: observerBoards.id,
        name: observerBoards.name,
      })
      .from(observerBoards)
      .orderBy(asc(observerBoards.name)),
    isEnabled(FEATURE_FLAGS.REQUIREMENT_BUILDER),
  ]);

  return (
    <SidebarProvider>
      <AppSidebar
        user={user}
        projects={projects}
        requirementBuilderEnabled={requirementBuilderEnabled}
      />
      <SidebarInset>{children}</SidebarInset>
      <CommandPalette
        projects={projects}
        teams={teams}
        isSuperUser={user.role === "SUPERUSER"}
        requirementBuilderEnabled={requirementBuilderEnabled}
      />
    </SidebarProvider>
  );
}
