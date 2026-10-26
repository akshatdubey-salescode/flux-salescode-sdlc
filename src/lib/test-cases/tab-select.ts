// Picks which tab(s) of a workbook/sheet hold the TCs for an issue. The user can
// always choose; this decides what is read when they do not: the previous round's
// tabs, the tab in the link's #gid, the only visible tab, and otherwise ALL visible
// tabs (the caller warns that no tab was named). A tab whose name contains the Jira
// key is only suggested (a badge), it never narrows the review by itself.

import { tabMatchesJiraKey } from "./template";

export type TabInfo = { title: string; hidden: boolean; sheetId?: number };

export function chooseTab(args: {
  tabs: TabInfo[];
  /** Tab the user picked explicitly. */
  requested?: string | null;
  /** From the link's #gid=... (Google Sheets only). */
  gid?: number | null;
  jiraKey: string;
  /** Whether a tab named after the Jira key counts (the badge does; the default selection does not). */
  useKeyMatch?: boolean;
}): string | null {
  const visible = args.tabs.filter((t) => !t.hidden);

  if (args.requested) {
    return visible.some((t) => t.title === args.requested) ? args.requested : null;
  }
  if (args.gid !== null && args.gid !== undefined) {
    const byGid = visible.find((t) => t.sheetId === args.gid);
    if (byGid) return byGid.title;
  }
  if (visible.length === 1) return visible[0].title;
  if (args.useKeyMatch === false) return null;
  const byKey = visible.filter((t) => tabMatchesJiraKey(t.title, args.jiraKey));
  return byKey.length === 1 ? byKey[0].title : null;
}

export type TabPick =
  | {
      ok: true;
      selected: string[];
      /** Previously used tabs that are not in this source any more. */
      missingPrevious: string[];
      /** No tab was named, so every visible tab was taken: the caller must warn. */
      defaulted: boolean;
    }
  | { ok: false; missing: string };

/**
 * Which tabs make up the item's test cases, in this order:
 *  1. the user's explicit list (every entry must be a visible tab);
 *  2. untouched form: the previous round's tabs that still exist (a resubmission), else the link's #gid tab, else the only
 *     visible tab;
 *  3. otherwise all visible tabs (`defaulted`): nothing was named, so the whole source is reviewed, with a warning.
 * An explicit empty list (the user cleared every tab) is "nothing named" too.
 */
export function pickTabs(args: {
  tabs: TabInfo[];
  /** The user's explicit selection; undefined/null = the form has not been touched. */
  requested?: string[] | null;
  /** Tabs of the item's latest round. */
  previous?: string[];
  gid?: number | null;
  jiraKey: string;
}): TabPick {
  const visibleTabs = args.tabs.filter((t) => !t.hidden);
  const visible = new Set(visibleTabs.map((t) => t.title));
  const previous = args.previous ?? [];
  const missingPrevious = previous.filter((t) => !visible.has(t));
  const all = (): TabPick => ({ ok: true, selected: visibleTabs.map((t) => t.title), missingPrevious, defaulted: visibleTabs.length > 1 });

  if (args.requested && args.requested.length > 0) {
    const unique = [...new Set(args.requested)];
    const bad = unique.find((t) => !visible.has(t));
    if (bad !== undefined) return { ok: false, missing: bad };
    return { ok: true, selected: unique, missingPrevious, defaulted: false };
  }
  if (args.requested) return all(); // the user cleared every tab

  const kept = previous.filter((t) => visible.has(t));
  if (kept.length > 0) return { ok: true, selected: kept, missingPrevious, defaulted: false };

  const named = chooseTab({ tabs: args.tabs, gid: args.gid, jiraKey: args.jiraKey, useKeyMatch: false });
  if (named) return { ok: true, selected: [named], missingPrevious, defaulted: false };
  return all();
}

/** Tabs in alphabetical order for the picker (case-insensitive, numbers by value: "Tab 2" before "Tab 10"; stray leading spaces ignored). */
export function sortTabsByName<T extends { title: string }>(tabs: T[]): T[] {
  return [...tabs].sort((a, b) => a.title.trim().localeCompare(b.title.trim(), undefined, { numeric: true, sensitivity: "base" }));
}
