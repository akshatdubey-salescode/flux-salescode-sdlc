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
 * Alongside it we store the *known* set — every href that existed in the
 * catalog when the preference was last saved. An href absent from the known
 * set is a nav item shipped AFTER the user customised their sidebar, and it
 * defaults to visible; a bare allow-list would silently hide every new
 * feature from every user with a saved preference. Preferences saved before
 * the known set existed fall back to plain allow-list behaviour until the
 * user next saves.
 *
 * Unknown hrefs (e.g. a menu item that was later removed) are ignored by
 * consumers, so stale entries never break the sidebar.
 */
export const SIDEBAR_PREFS_KEY = "sidebar.visibleItems";
export const SIDEBAR_KNOWN_KEY = "sidebar.knownItems";

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

// Same reference-stability contract as readVisibleHrefs, for the known set.
let cachedKnownRaw: string | null | undefined;
let cachedKnownHrefs: string[] | null = null;

export function readKnownHrefs(): string[] | null {
  if (typeof window === "undefined") return null;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SIDEBAR_KNOWN_KEY);
  } catch {
    return null;
  }

  if (raw !== cachedKnownRaw) {
    cachedKnownRaw = raw;
    cachedKnownHrefs = parseVisibleHrefs(raw);
  }
  return cachedKnownHrefs;
}

// Distinct from `null` (a legitimate "no preference saved" value) — lets us
// tell "haven't hydrated yet" apart from "hydrated, nothing saved".
function getServerSnapshot(): string[] | null | undefined {
  return undefined;
}

function subscribe(callback: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SIDEBAR_PREFS_KEY || e.key === SIDEBAR_KNOWN_KEY) {
      callback();
    }
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
  const knownSnapshot = useSyncExternalStore(subscribe, readKnownHrefs, getServerSnapshot);
  const hydrated = snapshot !== undefined;
  const visibleHrefs = hydrated ? snapshot : null;
  const knownHrefs = knownSnapshot === undefined ? null : knownSnapshot;

  /**
   * Persist the visible set. Pass `null` to clear the preference (show all).
   * `knownHrefs` should be the full catalog of hrefs the save was made
   * against — anything shipped later then defaults to visible.
   */
  const saveVisibleHrefs = useCallback(
    (hrefs: string[] | null, knownCatalog?: string[]) => {
      try {
        if (hrefs === null) {
          window.localStorage.removeItem(SIDEBAR_PREFS_KEY);
          window.localStorage.removeItem(SIDEBAR_KNOWN_KEY);
        } else {
          window.localStorage.setItem(SIDEBAR_PREFS_KEY, JSON.stringify(hrefs));
          if (knownCatalog) {
            window.localStorage.setItem(SIDEBAR_KNOWN_KEY, JSON.stringify(knownCatalog));
          }
        }
      } catch {
        // ignore (quota exceeded, private browsing, etc.)
      }
      window.dispatchEvent(new Event(PREFS_CHANGE_EVENT));
    },
    []
  );

  const isVisible = useCallback(
    (href: string) =>
      visibleHrefs === null ||
      visibleHrefs.includes(href) ||
      // Shipped after the user's last save → visible by default. Without a
      // stored known set (legacy saves) fall back to the plain allow-list.
      (knownHrefs !== null && !knownHrefs.includes(href)),
    [visibleHrefs, knownHrefs]
  );

  return { visibleHrefs, knownHrefs, isVisible, saveVisibleHrefs, hydrated };
}
