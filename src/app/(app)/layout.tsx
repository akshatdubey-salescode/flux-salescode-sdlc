import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraProjects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuth();

  const projects = await db
    .select({
      id: jiraProjects.id,
      name: jiraProjects.name,
      jiraProjectKey: jiraProjects.jiraProjectKey,
    })
    .from(jiraProjects)
    .where(eq(jiraProjects.isActive, true))
    .orderBy(jiraProjects.name);

  return (
    <SidebarProvider>
      <AppSidebar user={user} projects={projects} />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
