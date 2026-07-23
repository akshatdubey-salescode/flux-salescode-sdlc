"use client";

import { useState } from "react";
import { RiUserLine, RiCloseLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { useDebouncedSearch } from "@/components/delay-tracker/use-debounced-search";

export type Person = { email: string; name: string };

async function searchPeople(query: string): Promise<Person[]> {
  const res = await fetch(`/api/observer/developers?q=${encodeURIComponent(query)}&limit=10`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { email: string; name: string }[];
  return data.map((d) => ({ email: d.email, name: d.name }));
}

/**
 * Multi-person search-select for a delivery's responsible people — same
 * remote-search shell as PersonPicker (Popover + Command, debounced against
 * /api/observer/developers), but selection is a list with checkboxes
 * (doesn't close on select) plus removable chips, since PersonPicker itself
 * is single-select only.
 */
export function ResponsiblePeoplePicker({
  value,
  onChange,
}: {
  value: Person[];
  onChange: (people: Person[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const results = useDebouncedSearch(open, query, searchPeople);

  function toggle(person: Person) {
    const exists = value.some((p) => p.email === person.email);
    onChange(exists ? value.filter((p) => p.email !== person.email) : [...value, person]);
  }
  function remove(email: string) {
    onChange(value.filter((p) => p.email !== email));
  }

  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((p) => (
            <span
              key={p.email}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]"
            >
              {p.name || p.email}
              <button
                type="button"
                onClick={() => remove(p.email)}
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
            <RiUserLine className="size-3.5 shrink-0 opacity-60" />
            <span className="truncate text-muted-foreground">
              {value.length > 0 ? `${value.length} selected` : "Add responsible people…"}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search people…" value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>No matching person.</CommandEmpty>
              <CommandGroup>
                {results.map((p) => (
                  <CommandItem key={p.email} value={p.email} onSelect={() => toggle(p)}>
                    <Checkbox
                      checked={value.some((v) => v.email === p.email)}
                      onCheckedChange={() => toggle(p)}
                      className="mr-2"
                    />
                    <span className="truncate">{p.name}</span>
                    <span className="ml-1 truncate text-muted-foreground">{p.email}</span>
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
