"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Runs `search(query)` 250ms after `query` (or any of `deps`) last changed,
 * only while `active` — shared by PersonPicker and LinkedIssuePicker's
 * Popover-driven search-selects so the debounce/cleanup logic lives in one
 * place instead of two near-identical copies.
 */
export function useDebouncedSearch<T>(
  active: boolean,
  query: string,
  search: (query: string) => Promise<T[]>,
  deps: unknown[] = []
): T[] {
  const [results, setResults] = useState<T[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!active) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      search(query)
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` is a fixed-shape array per call site (e.g. always [projectId])
  }, [active, query, ...deps]);

  return results;
}
