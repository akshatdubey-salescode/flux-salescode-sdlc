"use client";

import { useRef, useState } from "react";

/**
 * Typeahead over everyone the system knows — the Keka directory plus Jira
 * assignees/reporters and board members, the same source the Team Pulse member
 * picker searches.
 *
 * Extracted so the compose dialog's recipient picker and the schedule list's
 * "add more people" editor share one debounce and one endpoint instead of
 * growing two subtly different copies.
 */

export type KnownPerson = { email: string; name: string };

const DEBOUNCE_MS = 250;

export function usePersonSearch(limit = 8) {
  const [query, setQueryState] = useState("");
  const [suggestions, setSuggestions] = useState<KnownPerson[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function setQuery(value: string) {
    setQueryState(value);
    if (timer.current) clearTimeout(timer.current);
    const q = value.trim();
    if (!q) {
      setSuggestions([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/observer/developers?q=${encodeURIComponent(q)}&limit=${limit}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error();
        const rows = (await res.json()) as KnownPerson[];
        setSuggestions(rows.map((r) => ({ email: r.email, name: r.name })));
      } catch {
        setSuggestions([]);
      }
    }, DEBOUNCE_MS);
  }

  function clear() {
    if (timer.current) clearTimeout(timer.current);
    setQueryState("");
    setSuggestions([]);
  }

  return { query, setQuery, suggestions, clear };
}
