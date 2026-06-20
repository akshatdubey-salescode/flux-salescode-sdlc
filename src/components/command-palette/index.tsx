"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { NAV_ITEMS } from "@/components/app-sidebar";
import {
  RiFolderLine,
  RiUserSettingsLine,
  RiExternalLinkLine,
  RiFlag2Line,
  RiTeamLine,
  RiMedalLine,
} from "@remixicon/react";
import type { JiraProject, ObserverBoard } from "@/lib/db/schema";

type Props = {
  projects: Pick<JiraProject, "id" | "name" | "jiraProjectKey">[];
  teams: Pick<ObserverBoard, "id" | "name">[];
  isSuperUser: boolean;
  requirementBuilderEnabled: boolean;
};

type JiraResult = {
  id: string;
  jiraKey: string;
  summary: string;
  status: string;
  issueType: string;
  projectId: string;
};

const JIRA_RESULT_LIMIT = 8;

export function CommandPalette({ projects, teams, isSuperUser, requirementBuilderEnabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [jiraResults, setJiraResults] = useState<JiraResult[]>([]);
  const [jiraLoading, setJiraLoading] = useState(false);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      // ⌘, (Ctrl+, on Windows/Linux) — jump to Settings.
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setOpen(false);
        router.push("/settings");
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router]);

  const fetchJira = useCallback((q: string) => {
    clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setJiraResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setJiraLoading(true);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(q)}&pageSize=${JIRA_RESULT_LIMIT}`
        );
        const data = await res.json();
        setJiraResults(data.issues ?? []);
      } catch {
        setJiraResults([]);
      } finally {
        setJiraLoading(false);
      }
    }, 300);
  }, []);

  useEffect(() => {
    fetchJira(query);
    return () => clearTimeout(debounceRef.current);
  }, [query, fetchJira]);

  function navigate(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  function handleOpenChange(value: boolean) {
    setOpen(value);
    if (!value) setQuery("");
  }

  const q = query.toLowerCase();

  const filteredNav = [
    ...NAV_ITEMS.filter(({ href }) => href !== "/requirements" || requirementBuilderEnabled),
    ...(isSuperUser
      ? [
          { label: "Performance Review", href: "/performance-review", icon: RiMedalLine },
          { label: "User Management", href: "/admin/users", icon: RiUserSettingsLine },
          { label: "Superuser Tools", href: "/superuser", icon: RiFlag2Line },
        ]
      : []),
  ].filter((item) => !q || item.label.toLowerCase().includes(q));

  const filteredProjects = projects.filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.jiraProjectKey.toLowerCase().includes(q)
  );

  const filteredTeams = teams.filter(
    (t) => !q || t.name.toLowerCase().includes(q)
  );

  const showEmpty =
    !jiraLoading &&
    filteredNav.length === 0 &&
    filteredProjects.length === 0 &&
    filteredTeams.length === 0 &&
    jiraResults.length === 0;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[20%] z-50 w-full max-w-2xl -translate-x-1/2 overflow-hidden rounded-xl bg-popover shadow-2xl ring-1 ring-foreground/10 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          <DialogPrimitive.Title className="sr-only">
            Command Palette
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Navigate to pages and search Jira issues
          </DialogPrimitive.Description>
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Go to page, project, team, or search Jira…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList className="max-h-[60vh]">
              {showEmpty && (
                <CommandEmpty>No results for &ldquo;{query}&rdquo;</CommandEmpty>
              )}
              {jiraLoading && query.trim() && (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Searching Jira…
                </p>
              )}

              {filteredNav.length > 0 && (
                <CommandGroup heading="Pages">
                  {filteredNav.map(({ label, href, icon: Icon }) => (
                    <CommandItem
                      key={href}
                      value={label}
                      onSelect={() => navigate(href)}
                    >
                      <Icon />
                      {label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {filteredProjects.length > 0 && (
                <>
                  {filteredNav.length > 0 && <CommandSeparator />}
                  <CommandGroup heading="Projects">
                    {filteredProjects.map((p) => (
                      <CommandItem
                        key={p.id}
                        value={`${p.name} ${p.jiraProjectKey}`}
                        onSelect={() => navigate(`/projects/${p.id}`)}
                      >
                        <RiFolderLine />
                        <span className="flex-1 truncate">{p.name}</span>
                        <CommandShortcut>{p.jiraProjectKey}</CommandShortcut>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {filteredTeams.length > 0 && (
                <>
                  {(filteredNav.length > 0 || filteredProjects.length > 0) && <CommandSeparator />}
                  <CommandGroup heading="Teams">
                    {filteredTeams.map((t) => (
                      <CommandItem
                        key={t.id}
                        value={t.name}
                        onSelect={() => navigate(`/observer/${t.id}`)}
                      >
                        <RiTeamLine />
                        <span className="flex-1 truncate">{t.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {jiraResults.length > 0 && (
                <>
                  {(filteredNav.length > 0 || filteredProjects.length > 0 || filteredTeams.length > 0) && (
                    <CommandSeparator />
                  )}
                  <CommandGroup heading="Jira Issues">
                    {jiraResults.map((issue) => (
                      <CommandItem
                        key={issue.id}
                        value={`${issue.jiraKey} ${issue.summary}`}
                        onSelect={() => navigate(`/issues/${issue.jiraKey}`)}
                      >
                        <RiExternalLinkLine className="shrink-0 text-muted-foreground" />
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {issue.jiraKey}
                        </span>
                        <span className="flex-1 truncate">{issue.summary}</span>
                        <CommandShortcut className="shrink-0">
                          {issue.status}
                        </CommandShortcut>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
