"use client";

import { useState } from "react";

const STORAGE_KEY = "myTasks.visibleColumns";

/** Columns the user can show/hide in the My Tasks list view. */
export const TOGGLEABLE_COLUMNS = [
  { key: "type", label: "Type" },
  { key: "key", label: "Key" },
  { key: "summary", label: "Summary" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "assignee", label: "Assignee" },
  { key: "reporter", label: "Reporter" },
  { key: "planned", label: "Plan" },
  { key: "created", label: "Created" },
  { key: "updated", label: "Updated" },
] as const;

export type ColumnKey = (typeof TOGGLEABLE_COLUMNS)[number]["key"];

const ALL_KEYS = TOGGLEABLE_COLUMNS.map((c) => c.key) as ColumnKey[];

function readFromStorage(): Set<ColumnKey> {
  if (typeof window === "undefined") return new Set(ALL_KEYS);
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return new Set(ALL_KEYS);
    const parsed = JSON.parse(stored) as string[];
    // Keep only keys we still recognise, so renamed/removed columns don't linger.
    const valid = parsed.filter((k): k is ColumnKey =>
      ALL_KEYS.includes(k as ColumnKey)
    );
    return new Set(valid);
  } catch {
    return new Set(ALL_KEYS);
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
  const [visibleColumns, setVisibleColumns] =
    useState<Set<ColumnKey>>(readFromStorage);

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
