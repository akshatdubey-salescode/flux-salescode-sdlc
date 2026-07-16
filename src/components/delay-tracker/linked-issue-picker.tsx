"use client";

import { useEffect, useState } from "react";
import { RiLinkM } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useDebouncedSearch } from "./use-debounced-search";

type Project = { id: string; name: string; jiraProjectKey: string };
type IssueResult = { id: string; jiraKey: string; summary: string };
export type LinkedIssue = { projectId: string; issueId: string; jiraKey: string; summary: string };

/**
 * Two-step picker for "Other Project Task/Bug": pick the project first, then
 * search-and-select the specific issue within it (scoped via /api/search's
 * existing `projects` filter — no new endpoint needed).
 */
export function LinkedIssuePicker({
  value,
  onChange,
  excludedProjectId,
}: {
  value: LinkedIssue | null;
  onChange: (linked: LinkedIssue | null) => void;
  excludedProjectId: string;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>(value?.projectId ?? "");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/projects")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data: Project[]) => setProjects(data.filter((project) => project.id !== excludedProjectId)))
      .catch(() => setProjects([]));
  }, [excludedProjectId]);

  const results = useDebouncedSearch(
    open && !!projectId,
    query,
    async (q) => {
      const res = await fetch(`/api/search?projects=${encodeURIComponent(projectId)}&q=${encodeURIComponent(q)}&pageSize=10`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { issues: IssueResult[] };
      return data.issues ?? [];
    },
    projectId
  );

  const selectedProject = projects.find((p) => p.id === projectId);

  return (
    <div className="flex gap-2">
      <Select
        value={projectId}
        onValueChange={(id) => {
          setProjectId(id);
          setQuery("");
          // The already-selected issue belongs to the OLD project — clear it
          // so a stale cross-project pairing can't be submitted while the
          // dropdown visibly shows the newly picked project.
          if (value && value.projectId !== id) onChange(null);
        }}
      >
        <SelectTrigger size="sm" className="w-36">
          <SelectValue placeholder="Project…" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="flex-1 justify-start gap-1.5" disabled={!projectId}>
            <RiLinkM className="size-3.5 shrink-0 opacity-60" />
            <span className="truncate">
              {value ? `${value.jiraKey} — ${value.summary}` : "Select issue…"}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={selectedProject ? `Search ${selectedProject.jiraProjectKey}…` : "Search…"}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>No matching issue.</CommandEmpty>
              <CommandGroup>
                {results.map((i) => (
                  <CommandItem
                    key={i.id}
                    value={i.jiraKey}
                    onSelect={() => {
                      onChange({ projectId, issueId: i.id, jiraKey: i.jiraKey, summary: i.summary });
                      setOpen(false);
                    }}
                  >
                    <span className="font-mono font-medium">{i.jiraKey}</span>
                    <span className="truncate text-muted-foreground">{i.summary}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
