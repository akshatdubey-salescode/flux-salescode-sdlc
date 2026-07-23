import { eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects, observerBoards } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { CommandPalette } from "@/components/command-palette";
import { WhatsNewProvider } from "@/components/whats-new/context";
import { DeliveryBanner } from "@/components/delivery-tracker/delivery-banner";
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
      <SidebarInset>
        <WhatsNewProvider>{children}</WhatsNewProvider>
      </SidebarInset>
      <CommandPalette
        projects={projects}
        teams={teams}
        isSuperUser={user.role === "SUPERUSER"}
        requirementBuilderEnabled={requirementBuilderEnabled}
      />
      <DeliveryBanner userEmail={user.email} />
    </SidebarProvider>
  );
}
