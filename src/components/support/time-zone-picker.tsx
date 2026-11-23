"use client";

import { useMemo, useState } from "react";
import { RiArrowDownSLine, RiCheckLine, RiGlobalLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatZonedDateTime, timeZoneOptions, zoneLabel } from "@/lib/support/tz";

/** Searchable IANA timezone picker, e.g. "America/Argentina/Buenos_Aires · GMT-3". */
export function TimeZonePicker({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (tz: string) => void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const options = useMemo(() => {
    const now = new Date();
    return timeZoneOptions().map((tz) => ({ tz, label: zoneLabel(tz, now) }));
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" role="combobox" aria-expanded={open} className="w-80 justify-between font-normal">
          <span className="flex min-w-0 items-center gap-2">
            <RiGlobalLine className="text-muted-foreground" />
            <span className="truncate">{value}</span>
            <span className="text-xs text-muted-foreground">{zoneLabel(value)}</span>
          </span>
          <RiArrowDownSLine className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Search city or region…" />
          <CommandList>
            <CommandEmpty>No matching timezone.</CommandEmpty>
            <CommandGroup>
              {options.map(({ tz, label }) => (
                <CommandItem
                  key={tz}
                  value={`${tz} ${label}`}
                  onSelect={() => {
                    onChange(tz);
                    setOpen(false);
                  }}
                >
                  <RiCheckLine className={cn("size-4", tz === value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{tz.replace(/_/g, " ")}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** "Now there: 20 Nov 2026, 17:05" helper line for the settings form. */
export function localTimeHint(tz: string): string {
  return `Now there: ${formatZonedDateTime(new Date(), tz)} ${zoneLabel(tz)}`;
}
