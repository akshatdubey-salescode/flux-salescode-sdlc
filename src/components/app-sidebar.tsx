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
  RiLogoutBoxRLine,
  RiBriefcaseLine,
  RiUserSettingsLine,
} from "@remixicon/react";
import { ThemeToggle } from "@/components/theme-toggle";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
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
  { label: "All Projects", href: "/projects", icon: RiBriefcaseLine },
];

export function AppSidebar({ user, projects }: Props) {
  const pathname = usePathname();
  const { user: clerkUser } = useUser();

  return (
    <Sidebar collapsible="icon">
      {/* Brand */}
      <SidebarHeader className="py-2 px-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="hover:bg-sidebar-accent transition-colors">
              <Link href="/home" className="flex items-center gap-2.5">
                <div className="flex aspect-square size-9 items-center justify-center rounded-md bg-gradient-to-br from-[#00c6b1] to-[#227c9d] text-white shadow-sm ring-1 ring-white/20">
                  <span className="text-base font-bold">F</span>
                </div>
                <div className="flex flex-col gap-0 leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="text-[14px] font-bold tracking-tight text-foreground">
                    Flux - SDLC Insights
                  </span>
                  <div className="flex flex-col -space-y-0.5">
                    <span className="text-[10px] font-semibold text-muted-foreground/80">
                      for Salescode.ai
                    </span>
                  </div>
                </div>
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
                    className="transition-all hover:bg-sidebar-accent hover:translate-x-0.5"
                  >
                    <Link href={href}>
                      <Icon className="text-muted-foreground group-data-[active=true]:text-primary" />
                      <span className="font-medium">{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {user.role === "SUPERUSER" && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === "/admin/users"}
                    tooltip="User Management"
                    className="transition-all hover:bg-sidebar-accent hover:translate-x-0.5"
                  >
                    <Link href="/admin/users">
                      <RiUserSettingsLine className="text-muted-foreground group-data-[active=true]:text-primary" />
                      <span className="font-medium">User Management</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator className="opacity-50" />

        {/* Projects */}
        <SidebarGroup>
          <div className="flex items-center justify-between pr-2 group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-widest text-zinc-500/70 dark:text-zinc-400/50">
              Projects
            </SidebarGroupLabel>
            {user.role === "SUPERUSER" && (
              <Link
                href="/projects/new"
                className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-all"
                title="Add Project"
              >
                <RiAddLine size={14} />
              </Link>
            )}
          </div>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects.map((project) => (
                <SidebarMenuItem key={project.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith(`/projects/${project.id}`)}
                    tooltip={project.name}
                    className="hover:translate-x-0.5 transition-transform"
                  >
                    <Link href={`/projects/${project.id}`}>
                      <RiFolderLine className="text-muted-foreground group-data-[active=true]:text-primary" />
                      <span className="truncate">{project.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator className="opacity-50" />

      {/* User + sign out */}
      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center justify-between px-1 mb-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
              <span className="text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                Theme
              </span>
              <ThemeToggle />
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  tooltip={user.email}
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="size-8 rounded-lg">
                    <AvatarImage src={clerkUser?.imageUrl} alt={user.email} />
                    <AvatarFallback className="rounded-lg text-xs">
                      {user.email[0].toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-col items-start text-left group-data-[collapsible=icon]:hidden">
                    <span className="truncate text-sm font-semibold leading-tight">
                      {clerkUser?.firstName
                        ? `${clerkUser.firstName}${clerkUser.lastName ? ` ${clerkUser.lastName}` : ""}`
                        : user.email.split("@")[0]}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground leading-tight">
                      {user.email}
                    </span>
                  </div>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="right"
                align="end"
                sideOffset={4}
                className="w-56"
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-2 py-2">
                    <Avatar className="size-8 rounded-lg">
                      <AvatarImage src={clerkUser?.imageUrl} alt={user.email} />
                      <AvatarFallback className="rounded-lg text-xs">
                        {user.email[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold">
                        {clerkUser?.firstName
                          ? `${clerkUser.firstName}${clerkUser.lastName ? ` ${clerkUser.lastName}` : ""}`
                          : user.email.split("@")[0]}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {user.email}
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <SignOutButton redirectUrl="/">
                  <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive">
                    <RiLogoutBoxRLine className="size-4" />
                    Sign Out
                  </DropdownMenuItem>
                </SignOutButton>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
