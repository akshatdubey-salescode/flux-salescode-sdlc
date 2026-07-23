"use client";

import { useState } from "react";
import { RiSearchLine, RiCloseLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { useDebouncedSearch } from "@/components/delay-tracker/use-debounced-search";

export type IssueResult = { id: string; jiraKey: string; summary: string };

/**
 * Multi-select Jira issue search, scoped to one project — extends
 * LinkedIssuePicker's search pattern (Command + /api/search) but since a
 * delivery is already project-scoped there's no project-Select step, and
 * selection doesn't close the popover (checkbox multi-select + chip list).
 */
export function IssueMultiPicker({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: IssueResult[];
  onChange: (issues: IssueResult[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const results = useDebouncedSearch(
    open,
    query,
    async (q) => {
      const res = await fetch(`/api/search?projects=${encodeURIComponent(projectId)}&q=${encodeURIComponent(q)}&pageSize=10`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { issues: IssueResult[] };
      return data.issues ?? [];
    },
    projectId
  );

  function toggle(issue: IssueResult) {
    const exists = value.some((i) => i.id === issue.id);
    onChange(exists ? value.filter((i) => i.id !== issue.id) : [...value, issue]);
  }
  function remove(id: string) {
    onChange(value.filter((i) => i.id !== id));
  }

  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((i) => (
            <span
              key={i.id}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]"
            >
              <span className="font-mono">{i.jiraKey}</span>
              <button
                type="button"
                onClick={() => remove(i.id)}
                className="text-muted-foreground hover:text-foreground"
              >
                <RiCloseLine className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="w-full justify-start gap-1.5">
            <RiSearchLine className="size-3.5 shrink-0 opacity-60" />
            <span className="truncate text-muted-foreground">
              {value.length > 0 ? `${value.length} issue${value.length === 1 ? "" : "s"} selected` : "Search issues to add…"}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-96 p-0">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search issues…" value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>No matching issue.</CommandEmpty>
              <CommandGroup>
                {results.map((i) => (
                  <CommandItem key={i.id} value={i.jiraKey} onSelect={() => toggle(i)}>
                    <Checkbox
                      checked={value.some((v) => v.id === i.id)}
                      onCheckedChange={() => toggle(i)}
                      className="mr-2"
                    />
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
