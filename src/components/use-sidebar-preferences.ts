"use client";

import { useCallback, useSyncExternalStore } from "react";

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

// `useSyncExternalStore` compares each snapshot against the previous one with
// `Object.is`, so this has to hand back the *same* array reference until the
// stored string actually changes. Parsing on every call returned a fresh array
// each time, so React saw the store as changed on every check and rescheduled
// a sync re-render forever -- React error #185, "Maximum update depth
// exceeded", which took down every page under (app). Cache the parse, keyed on
// the raw string we parsed it from.
let cachedRaw: string | null | undefined;
let cachedVisibleHrefs: string[] | null = null;

function parseVisibleHrefs(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((h): h is string => typeof h === "string");
  } catch {
    return null;
  }
}

// Exported for unit tests: the Object.is stability of this return value is
// load-bearing (see use-sidebar-preferences.test.ts).
export function readVisibleHrefs(): string[] | null {
  if (typeof window === "undefined") return null;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SIDEBAR_PREFS_KEY);
  } catch {
    // localStorage can throw outright (disabled cookies, some private modes).
    return null;
  }

  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedVisibleHrefs = parseVisibleHrefs(raw);
  }
  return cachedVisibleHrefs;
}

// Distinct from `null` (a legitimate "no preference saved" value) — lets us
// tell "haven't hydrated yet" apart from "hydrated, nothing saved".
function getServerSnapshot(): string[] | null | undefined {
  return undefined;
}

function subscribe(callback: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SIDEBAR_PREFS_KEY) callback();
  };
  window.addEventListener(PREFS_CHANGE_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(PREFS_CHANGE_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSidebarPreferences() {
  // useSyncExternalStore (not useState+useEffect) reads localStorage and
  // subscribes to changes without ever calling setState itself — the value
  // is `undefined` on the server and the first client render (matching
  // markup, no hydration mismatch), then syncs to the real value right after
  // mount and on every subsequent local/cross-tab change.
  const snapshot = useSyncExternalStore(subscribe, readVisibleHrefs, getServerSnapshot);
  const hydrated = snapshot !== undefined;
  const visibleHrefs = hydrated ? snapshot : null;

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
    window.dispatchEvent(new Event(PREFS_CHANGE_EVENT));
  }, []);

  const isVisible = useCallback(
    (href: string) => visibleHrefs === null || visibleHrefs.includes(href),
    [visibleHrefs]
  );

  return { visibleHrefs, isVisible, saveVisibleHrefs, hydrated };
}
