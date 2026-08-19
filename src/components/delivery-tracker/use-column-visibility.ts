"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "deliveryTracker.visibleColumns";

/** Columns the user can show/hide in each delivery's items table. */
export const TOGGLEABLE_COLUMNS = [
  { key: "key", label: "Key" },
  { key: "summary", label: "Summary" },
  { key: "jiraStatus", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "assignee", label: "Assignee" },
  { key: "delivery", label: "Delivery status" },
  { key: "startDate", label: "Start Date" },
  { key: "dueDate", label: "End Date" },
  { key: "comments", label: "Comments" },
] as const;

export type ColumnKey = (typeof TOGGLEABLE_COLUMNS)[number]["key"];

const ALL_KEYS = TOGGLEABLE_COLUMNS.map((c) => c.key) as ColumnKey[];

// Comments starts hidden — explicit opt-in only via the Columns menu;
// everything else defaults on.
const DEFAULT_KEYS = ALL_KEYS.filter((k) => k !== "comments");

function readFromStorage(): Set<ColumnKey> {
  if (typeof window === "undefined") return new Set(DEFAULT_KEYS);
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return new Set(DEFAULT_KEYS);
    const parsed = JSON.parse(stored) as string[];
    // Keep only keys we still recognise, so renamed/removed columns don't linger.
    const valid = parsed.filter((k): k is ColumnKey => ALL_KEYS.includes(k as ColumnKey));
    return new Set(valid);
  } catch {
    return new Set(DEFAULT_KEYS);
  }
}

function saveToStorage(keys: Set<ColumnKey>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // ignore (quota exceeded, private browsing, etc.)
  }
}

export function useColumnVisibility() {
  // Start from the SSR-safe default (all columns) so the first client render
  // matches the server HTML. The persisted selection is loaded after mount in
  // the effect below; reading localStorage during the initial render would
  // cause a hydration mismatch when the user has hidden/shown columns.
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(
    () => new Set(DEFAULT_KEYS)
  );

  useEffect(() => {
    setVisibleColumns(readFromStorage());
  }, []);

  function toggleColumn(key: ColumnKey) {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // Don't allow hiding the very last column.
        if (next.size <= 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      saveToStorage(next);
      return next;
    });
  }

  function resetColumns() {
    const next = new Set(ALL_KEYS);
    setVisibleColumns(next);
    saveToStorage(next);
  }

  return { visibleColumns, toggleColumn, resetColumns };
}
