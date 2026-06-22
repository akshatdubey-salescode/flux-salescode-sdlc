"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

const STORAGE_KEY = "my-tasks-pinned";
const MAX_PINS = 5;

function readFromStorage(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return new Set(stored ? (JSON.parse(stored) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function usePinnedTasks() {
  // Start empty (the SSR-safe default) so the first client render matches the
  // server HTML, then load the persisted pins after mount. Reading localStorage
  // during the initial render would reorder pinned rows and cause a hydration
  // mismatch.
  const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setPinnedKeys(readFromStorage());
  }, []);

  function togglePin(jiraKey: string) {
    setPinnedKeys((prev) => {
      if (prev.has(jiraKey)) {
        const next = new Set(prev);
        next.delete(jiraKey);
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
        return next;
      }

      if (prev.size >= MAX_PINS) {
        toast.warning("You can only pin up to 5 Jiras at a time");
        return prev;
      }

      const next = new Set(prev);
      next.add(jiraKey);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  return { pinnedKeys, togglePin };
}
