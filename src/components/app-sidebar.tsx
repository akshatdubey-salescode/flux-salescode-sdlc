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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/home" className="flex items-center gap-3">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-zinc-950 text-white shadow-lg ring-1 ring-zinc-800 dark:bg-white dark:text-zinc-950 dark:ring-zinc-200">
                  <span className="text-sm font-black italic tracking-tighter">F</span>
                </div>
                <div className="flex flex-col gap-0.5 leading-none group-data-[collapsible=icon]:hidden">
                  <span className="text-sm font-bold tracking-tight">Flux</span>
                  <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">
                    SDLC Management
                  </span>
                  <span className="text-[9px] font-medium text-zinc-400 dark:text-zinc-500 opacity-80">
                    for Salescode.ai
                  </span>
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
                    className="transition-all hover:bg-zinc-100 hover:translate-x-0.5 dark:hover:bg-zinc-800"
                  >
                    <Link href={href}>
                      <Icon className="text-zinc-400 group-data-[active=true]:text-inherit" />
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
                    className="transition-all hover:bg-zinc-100 hover:translate-x-0.5 dark:hover:bg-zinc-800"
                  >
                    <Link href="/admin/users">
                      <RiUserSettingsLine className="text-zinc-400 group-data-[active=true]:text-inherit" />
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
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 transition-all"
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
                      <RiFolderLine className="text-zinc-400 group-data-[active=true]:text-inherit" />
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
      <SidebarFooter className="p-4 group-data-[collapsible=icon]:p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center justify-between mb-2 group-data-[collapsible=icon]:justify-center">
              <span className="text-xs text-zinc-500 dark:text-zinc-400 group-data-[collapsible=icon]:hidden">
                Theme
              </span>
              <ThemeToggle />
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <Popover>
              <PopoverTrigger asChild>
                <div 
                  role="button"
                  className="flex h-14 w-full cursor-pointer items-center gap-3 rounded-xl border border-zinc-200/50 bg-white/50 px-3 shadow-sm backdrop-blur-md transition-all hover:bg-white/80 dark:border-zinc-800/50 dark:bg-zinc-900/50 dark:hover:bg-zinc-900/80 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:shadow-none"
                >
                  {/* Avatar */}
                  <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100 ring-2 ring-white/50 dark:bg-zinc-800 dark:ring-zinc-900/50">
                    {clerkUser?.imageUrl ? (
                      <img
                        src={clerkUser.imageUrl}
                        alt={user.email}
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="text-xs font-bold text-zinc-400">
                        {user.email[0].toUpperCase()}
                      </span>
                    )}
                  </div>
                  {/* Info */}
                  <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5 group-data-[collapsible=icon]:hidden">
                    <span className="truncate text-[13px] font-bold leading-none text-zinc-900 dark:text-zinc-50">
                      {clerkUser?.firstName
                        ? `${clerkUser.firstName}${clerkUser.lastName ? ` ${clerkUser.lastName}` : ""}`
                        : user.email.split("@")[0]}
                    </span>
                    <span className="truncate text-[11px] font-medium leading-none text-zinc-500 dark:text-zinc-400">
                      {user.email}
                    </span>
                  </div>
                </div>
              </PopoverTrigger>
              <PopoverContent side="right" align="end" className="w-56 p-1">
                <SignOutButton redirectUrl="/">
                  <button className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm font-medium text-red-600 outline-none transition-colors hover:bg-red-50 focus:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50 dark:focus:bg-red-950/50">
                    Sign Out
                    <RiLogoutBoxRLine className="size-4" />
                  </button>
                </SignOutButton>
              </PopoverContent>
            </Popover>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
