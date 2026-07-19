"use client";

import { useState } from "react";
import { RiUserLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useDebouncedSearch } from "./use-debounced-search";

type Person = { email: string; name: string };

async function searchPeople(query: string): Promise<Person[]> {
  const res = await fetch(`/api/observer/developers?q=${encodeURIComponent(query)}&limit=10`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { email: string; name: string }[];
  return data.map((d) => ({ email: d.email, name: d.name }));
}

/**
 * Single-person search-select for "responsible for this delay". Backed by
 * the existing /api/observer/developers endpoint (assignee name/email
 * search) — no new endpoint needed.
 */
export function PersonPicker({
  value,
  onChange,
  allowClear = false,
}: {
  value: Person | null;
  onChange: (person: Person | null) => void;
  /**
   * Shows an explicit "None" option and displays "None" (not "Select
   * person…") when unset — for categories where a responsible person isn't
   * mandatory, so the field has a real, selectable no-one-assigned state
   * instead of just an empty prompt. Filter-bar usage leaves this off, since
   * a filter's "unset" state already reads correctly as "Select person…".
   */
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const results = useDebouncedSearch(open, query, searchPeople);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-start gap-1.5">
          <RiUserLine className="size-3.5 shrink-0 opacity-60" />
          <span className={value ? "truncate" : "truncate text-muted-foreground"}>
            {value ? value.name || value.email : allowClear ? "None" : "Select person…"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search people…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No matching person.</CommandEmpty>
            <CommandGroup>
              {allowClear && (
                <CommandItem
                  value="__none__"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <span className="text-muted-foreground italic">None</span>
                </CommandItem>
              )}
              {results.map((p) => (
                <CommandItem
                  key={p.email}
                  value={p.email}
                  onSelect={() => {
                    onChange(p);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="ml-1 truncate text-muted-foreground">{p.email}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
