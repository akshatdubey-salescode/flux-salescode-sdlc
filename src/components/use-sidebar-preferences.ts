"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Persists which sidebar menu items the user wants to see.
 *
 * Items are identified by their `href` (a stable id) since the icon component
 * references in the nav config can't be serialised. We store the *visible* set:
 *
 *   • `null` (no entry)  → no preference saved yet, so every item is shown.
 *   • `string[]`         → an explicit allow-list; only these hrefs are shown.
 *
 * Unknown hrefs (e.g. a menu item that was later removed) are ignored by
 * consumers, so stale entries never break the sidebar.
 */
export const SIDEBAR_PREFS_KEY = "sidebar.visibleItems";

// Dispatched on the window so the live sidebar updates the moment preferences
// change in the *same* tab — the native `storage` event only fires in *other*
// tabs.
const PREFS_CHANGE_EVENT = "sidebar-prefs-change";

function readVisibleHrefs(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SIDEBAR_PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((h): h is string => typeof h === "string");
  } catch {
    return null;
  }
}

export function useSidebarPreferences() {
  // Start as `null` on both the server and the first client render so the
  // markup matches and we don't trip a hydration mismatch. The real value is
  // loaded from localStorage right after mount.
  const [visibleHrefs, setVisibleHrefs] = useState<string[] | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setVisibleHrefs(readVisibleHrefs());
    setHydrated(true);

    const onLocalChange = () => setVisibleHrefs(readVisibleHrefs());
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === SIDEBAR_PREFS_KEY) {
        setVisibleHrefs(readVisibleHrefs());
      }
    };
    window.addEventListener(PREFS_CHANGE_EVENT, onLocalChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(PREFS_CHANGE_EVENT, onLocalChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  /** Persist the visible set. Pass `null` to clear the preference (show all). */
  const saveVisibleHrefs = useCallback((hrefs: string[] | null) => {
    try {
      if (hrefs === null) {
        window.localStorage.removeItem(SIDEBAR_PREFS_KEY);
      } else {
        window.localStorage.setItem(SIDEBAR_PREFS_KEY, JSON.stringify(hrefs));
      }
    } catch {
      // ignore (quota exceeded, private browsing, etc.)
    }
    setVisibleHrefs(hrefs);
    window.dispatchEvent(new Event(PREFS_CHANGE_EVENT));
  }, []);

  const isVisible = useCallback(
    (href: string) => visibleHrefs === null || visibleHrefs.includes(href),
    [visibleHrefs]
  );

  return { visibleHrefs, isVisible, saveVisibleHrefs, hydrated };
}
