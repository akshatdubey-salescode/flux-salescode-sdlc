"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import {
  RiHome3Line,
  RiTaskLine,
  RiSearchLine,
  RiFolderLine,
  RiAddLine,
  RiLogoutBoxRLine,
  RiBriefcaseLine,
  RiUserSettingsLine,
  RiFileList3Line,
  RiSettings3Line,
  RiTeamLine,
  RiCloseLine,
  RiFlag2Line,
  RiLightbulbLine,
  RiBarChart2Line,
  RiCalendarCheckLine,
  RiCheckboxCircleLine,
  RiCodeSSlashLine,
  RiFolderUserLine,
  RiUserStarLine,
  RiUserUnfollowLine,
  RiMedalLine,
  RiBugLine,
  RiAddBoxLine,
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
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useSidebarPreferences } from "@/components/use-sidebar-preferences";
import type { JiraProject } from "@/lib/db/schema";
import type { AuthUser } from "@/lib/auth/server";

type Props = {
  user: AuthUser;
  projects: Pick<JiraProject, "id" | "name" | "jiraProjectKey">[];
  requirementBuilderEnabled: boolean;
};

type NavItem = { label: string; href: string; icon: typeof RiHome3Line };
type NavSection = { label?: string; superuserOnly?: boolean; items: NavItem[] };

// The "All Projects" entry lives at the top of the Projects group (next to the
// dynamic project list), not in a nav section — but it's still exported in the
// flat NAV_ITEMS below so the command palette can find it.
const ALL_PROJECTS_ITEM: NavItem = {
  label: "All Projects",
  href: "/projects",
  icon: RiBriefcaseLine,
};

// Grouped by how the destination is used, not just by type:
//  • top (unlabeled) — the everyday entry point + global finder
//  • My Work        — your own, single-user "do work" pages
//  • Teams          — manager-daily people & capacity views
//  • Analytics      — org delivery/contribution reports (quarter-filtered)
//  • Admin          — superuser-only setup/ops
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: "Dashboard", href: "/home", icon: RiHome3Line },
      { label: "Search", href: "/search", icon: RiSearchLine },
    ],
  },
  {
    label: "My Work",
    items: [
      { label: "My Tasks", href: "/my-tasks", icon: RiTaskLine },
      { label: "Create Jira", href: "/create-jira", icon: RiAddBoxLine },
      { label: "Requirement Builder", href: "/requirements", icon: RiFileList3Line },
    ],
  },
  {
    label: "Teams",
    items: [
      { label: "Team Pulse", href: "/observer", icon: RiTeamLine },
      { label: "Workload", href: "/workload", icon: RiBarChart2Line },
      { label: "Availability", href: "/availability", icon: RiCalendarCheckLine },
    ],
  },
  {
    label: "Analytics",
    items: [
      { label: "Bug Board", href: "/bugs", icon: RiBugLine },
      { label: "Throughput", href: "/throughput", icon: RiCheckboxCircleLine },
      { label: "Lines of Code", href: "/views/lines-of-code", icon: RiCodeSSlashLine },
      { label: "People & Projects", href: "/views/people-projects", icon: RiFolderUserLine },
      { label: "Unplanned Assignees", href: "/views/top-unplanned-assignees", icon: RiUserStarLine },
      { label: "Self-Deassigners", href: "/views/self-deassigners", icon: RiUserUnfollowLine },
      { label: "Performance Review", href: "/performance-review", icon: RiMedalLine },
    ],
  },
  {
    label: "Admin",
    superuserOnly: true,
    items: [
      { label: "User Management", href: "/admin/users", icon: RiUserSettingsLine },
      { label: "Superuser Tools", href: "/superuser", icon: RiFlag2Line },
    ],
  },
];

// Flat list of non-admin nav links (plus All Projects) for the command palette,
// which appends the superuser links itself.
export const NAV_ITEMS: NavItem[] = [
  ...NAV_SECTIONS.filter((s) => !s.superuserOnly).flatMap((s) => s.items),
  ALL_PROJECTS_ITEM,
];

export function AppSidebar({ user, projects, requirementBuilderEnabled }: Props) {
  const pathname = usePathname();
  const { isVisible } = useSidebarPreferences();
  const { data: session } = useSession();
  const sessionUser = session?.user;
  const displayName = sessionUser?.name ?? user.email.split("@")[0];
  const avatarUrl = sessionUser?.image ?? undefined;

  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isSearching && searchInputRef.current) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isSearching]);

  const filteredProjects = projects.filter((project) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      project.name.toLowerCase().includes(q) ||
      project.jiraProjectKey?.toLowerCase().includes(q)
    );
  });

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

      <SidebarContent className="overflow-hidden">
        {(() => {
          const renderSection = (section: NavSection, pinned: boolean) => {
            if (section.superuserOnly && user.role !== "SUPERUSER") return null;
            const items = section.items.filter(
              ({ href }) =>
                (href !== "/requirements" || requirementBuilderEnabled) &&
                isVisible(href)
            );
            if (items.length === 0) return null;
            return (
              <SidebarGroup
                key={section.label ?? "primary"}
                className={cn("py-0.5", pinned && "shrink-0")}
              >
                {section.label && (
                  <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-widest text-zinc-500/70 dark:text-zinc-400/50">
                    {section.label}
                  </SidebarGroupLabel>
                )}
                <SidebarGroupContent>
                  <SidebarMenu>
                    {items.map(({ label, href, icon: Icon }) => (
                      <SidebarMenuItem key={href}>
                        <SidebarMenuButton
                          asChild
                          isActive={
                            href === "/home"
                              ? pathname === href
                              : pathname.startsWith(href)
                          }
                          tooltip={label}
                          className="transition-all hover:bg-sidebar-accent hover:translate-x-0.5"
                        >
                          <Link href={href}>
                            <Icon className="text-muted-foreground group-data-[active=true]:text-primary" />
                            <span className="font-medium flex-1">{label}</span>
                            {href === "/search" && (
                              <kbd className="group-data-[collapsible=icon]:hidden inline-flex items-center rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9px] leading-none text-muted-foreground/60">
                                ⌘K
                              </kbd>
                            )}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          };

          return (
            <>
              {/* Pinned: Dashboard + Search stay fixed at the top */}
              {renderSection(NAV_SECTIONS[0], true)}

              {/* Everything below scrolls together */}
              <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar flex flex-col">
                {NAV_SECTIONS.slice(1).map((section) => renderSection(section, false))}

                <SidebarSeparator className="opacity-50 shrink-0" />

                {/* Projects */}
                <SidebarGroup className="flex flex-col">
          <div className="flex items-center justify-between pr-2 shrink-0 group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-widest text-zinc-500/70 dark:text-zinc-400/50">
              Projects
            </SidebarGroupLabel>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  if (isSearching) {
                    setIsSearching(false);
                    setSearchQuery("");
                  } else {
                    setIsSearching(true);
                  }
                }}
                className={cn(
                  "rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-all duration-150",
                  isSearching && "bg-sidebar-accent text-foreground"
                )}
                title="Search Projects"
              >
                <RiSearchLine size={13} />
              </button>
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
          </div>

          {/* Animated Search input */}
          <div
            className={cn(
              "overflow-hidden transition-all duration-300 ease-in-out px-2 group-data-[collapsible=icon]:hidden",
              isSearching ? "max-h-10 opacity-100 mb-2 mt-1" : "max-h-0 opacity-0 mb-0 mt-0 pointer-events-none"
            )}
          >
            <div className="relative">
              <RiSearchLine className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/60 pointer-events-none" />
              <Input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter projects..."
                className="h-7 pl-7 pr-7 text-xs bg-zinc-50/50 dark:bg-zinc-900/50 focus-visible:ring-1 focus-visible:ring-ring/30 focus-visible:border-ring/60"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setIsSearching(false);
                    setSearchQuery("");
                  }
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/60 hover:text-foreground rounded transition-colors"
                >
                  <RiCloseLine className="size-3" />
                </button>
              )}
            </div>
          </div>

          {/* All Projects — entry point pinned above the project list */}
          <SidebarMenu className="shrink-0">
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname === "/projects"}
                tooltip="All Projects"
                className="transition-all hover:bg-sidebar-accent hover:translate-x-0.5"
              >
                <Link href="/projects">
                  <RiBriefcaseLine className="text-muted-foreground group-data-[active=true]:text-primary" />
                  <span className="font-medium">All Projects</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          <SidebarGroupContent>
            <SidebarMenu>
              {filteredProjects.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground/60 group-data-[collapsible=icon]:hidden">
                  No projects found
                </div>
              ) : (
                filteredProjects.map((project) => (
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
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
                </SidebarGroup>
              </div>
            </>
          );
        })()}
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
                    <AvatarImage src={avatarUrl} alt={user.email} />
                    <AvatarFallback className="rounded-lg text-xs">
                      {user.email[0].toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-col items-start text-left group-data-[collapsible=icon]:hidden">
                    <span className="truncate text-sm font-semibold leading-tight">
                      {displayName}
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
                      <AvatarImage src={avatarUrl} alt={user.email} />
                      <AvatarFallback className="rounded-lg text-xs">
                        {user.email[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold">
                        {displayName}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {user.email}
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/feature-request" className="cursor-pointer">
                    <RiLightbulbLine className="size-4" />
                    Feature Request
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings" className="cursor-pointer">
                    <RiSettings3Line className="size-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => signOut({ callbackUrl: "/" })}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <RiLogoutBoxRLine className="size-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
