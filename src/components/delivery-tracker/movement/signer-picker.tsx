"use client";

import { useEffect, useState } from "react";
import { RiUserLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { SIGNER_QUERY_MIN, validateSignerQuery, type SignerCandidate } from "@/lib/deliveries/signer-candidates";
import { api, movementsBase } from "./api";
import { signerSearchPhase } from "./view-model";

/**
 * Single-person search-select over FLUX USERS (GET movements/signer-candidates), not Jira assignees: a signer must be a
 * Flux user, so a person who is not one is never offered and an existing one is always found. Search starts at 2 characters.
 */
export function SignerPicker({ deliveryId, value, onChange, testId }: { deliveryId: string; value: SignerCandidate | null; onChange: (p: SignerCandidate) => void; testId?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The last ANSWERED search; "loading" is derived (this text has no answer yet), so a slow first request never reads as "no match".
  const [settled, setSettled] = useState<{ text: string; results: SignerCandidate[]; error: string | null } | null>(null);
  const text = query.trim();
  const valid = validateSignerQuery(query).ok;

  useEffect(() => {
    if (!open || !valid) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      const r = await api<{ candidates: SignerCandidate[] }>(`${movementsBase(deliveryId)}/signer-candidates?q=${encodeURIComponent(text)}`, { signal: ctl.signal, timeoutMs: 15_000 });
      if (ctl.signal.aborted || r.aborted) return; // superseded by a newer text, or the popover closed: its answer belongs to nobody
      setSettled(r.ok && r.data ? { text, results: r.data.candidates, error: null } : { text, results: [], error: r.error ?? "Search failed" });
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [open, valid, text, deliveryId]);

  const phase = signerSearchPhase(text, valid, settled && { text: settled.text, count: settled.results.length, error: settled.error });
  const shown = phase === "results" ? (settled?.results ?? []) : [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-start gap-1.5" data-testid={testId}>
          <RiUserLine className="size-3.5 shrink-0 opacity-60" />
          <span className={value ? "truncate" : "truncate text-muted-foreground"}>{value ? value.name || value.email : "Select person…"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search Flux users…" value={query} onValueChange={setQuery} />
          <CommandList>
            {phase === "short" && <p className="p-2 text-[11px] text-muted-foreground">Type at least {SIGNER_QUERY_MIN} characters of the name or e-mail.</p>}
            {phase === "loading" && (
              <p className="p-2 text-[11px] text-muted-foreground" role="status" data-testid="movement-signer-searching">
                Searching…
              </p>
            )}
            {phase === "error" && (
              <p className="p-2 text-[11px] text-destructive" role="alert" data-testid="movement-signer-search-error">
                {settled?.error}
              </p>
            )}
            {phase === "empty" && <p className="p-2 text-[11px] text-muted-foreground" data-testid="movement-signer-empty">No matching Flux user.</p>}
            <CommandGroup>
              {shown.map((p) => (
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
