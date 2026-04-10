"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton, useUser } from "@clerk/nextjs";
import {
  RiHome3Line,
  RiTaskLine,
  RiSearchLine,
  RiFolderLine,
  RiAddLine,
} from "@remixicon/react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import type { JiraProject } from "@/lib/db/schema";
import type { AuthUser } from "@/lib/auth/server";

type Props = {
  user: AuthUser;
  projects: Pick<JiraProject, "id" | "name" | "jiraProjectKey">[];
};

const NAV_ITEMS = [
  { label: "Dashboard", href: "/home", icon: RiHome3Line },
  { label: "My Tasks", href: "/my-tasks", icon: RiTaskLine },
  { label: "Search", href: "/search", icon: RiSearchLine },
];

export function AppSidebar({ user, projects }: Props) {
  const pathname = usePathname();
  const { user: clerkUser } = useUser();

  return (
    <Sidebar collapsible="icon">
      {/* Brand */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/home">
                <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900">
                  <span className="text-xs font-bold">F</span>
                </div>
                <span className="font-semibold tracking-tight">Flux</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Main nav */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map(({ label, href, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === href}
                    tooltip={label}
                  >
                    <Link href={href}>
                      <Icon />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        {/* Projects */}
        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects.map((project) => (
                <SidebarMenuItem key={project.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith(`/projects/${project.id}`)}
                    tooltip={project.name}
                  >
                    <Link href={`/projects/${project.id}`}>
                      <RiFolderLine />
                      <span>{project.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              {user.role === "SUPERUSER" && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === "/projects/new"}
                    tooltip="Add Project"
                  >
                    <Link href="/projects/new">
                      <RiAddLine />
                      <span>Add Project</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* User + sign out */}
      <SidebarFooter>
        <SidebarSeparator />
        <SidebarMenu>
          <SidebarMenuItem>
            <SignOutButton redirectUrl="/">
              <SidebarMenuButton
                size="lg"
                tooltip={user.email}
                className="group/user"
              >
                {/* Avatar */}
                <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                  {clerkUser?.imageUrl ? (
                    <img
                      src={clerkUser.imageUrl}
                      alt={user.email}
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      {user.email[0].toUpperCase()}
                    </span>
                  )}
                </div>
                {/* Info */}
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-50">
                    {clerkUser?.firstName
                      ? `${clerkUser.firstName}${clerkUser.lastName ? ` ${clerkUser.lastName}` : ""}`
                      : user.email.split("@")[0]}
                  </span>
                  <span className="truncate text-xs text-zinc-500">
                    {user.email}
                  </span>
                </div>
              </SidebarMenuButton>
            </SignOutButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
