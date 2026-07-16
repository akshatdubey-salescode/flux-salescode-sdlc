"use client";

import { useEffect, useEffectEvent, useState } from "react";

/**
 * Runs `search(query)` 250ms after `query` (or `dependency`) last changed,
 * only while `active` — shared by PersonPicker and LinkedIssuePicker's
 * Popover-driven search-selects so the debounce/cleanup logic lives in one
 * place instead of two near-identical copies.
 */
export function useDebouncedSearch<T>(
  active: boolean,
  query: string,
  search: (query: string) => Promise<T[]>,
  dependency?: unknown
): T[] {
  const [results, setResults] = useState<T[]>([]);
  const runSearch = useEffectEvent(search);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    const timeout = setTimeout(() => {
      runSearch(query)
        .then((nextResults) => {
          if (!cancelled) setResults(nextResults);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [active, query, dependency]);

  return results;
}
