// Picks which tab of a workbook/sheet holds the TCs for an issue. The user can
// always choose; this only decides the preselection so the common cases need no
// clicks: an explicit choice, the tab in the link's #gid, the only visible tab,
// or the single tab whose name contains the Jira key.

import { tabMatchesJiraKey } from "./template";

export type TabInfo = { title: string; hidden: boolean; sheetId?: number };

export function chooseTab(args: {
  tabs: TabInfo[];
  /** Tab the user picked explicitly. */
  requested?: string | null;
  /** From the link's #gid=... (Google Sheets only). */
  gid?: number | null;
  jiraKey: string;
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
  const byKey = visible.filter((t) => tabMatchesJiraKey(t.title, args.jiraKey));
  return byKey.length === 1 ? byKey[0].title : null;
}

export type TabPick =
  | { ok: true; selected: string[]; /** Previously used tabs that are not in this source any more. */ missingPrevious: string[] }
  | { ok: false; missing: string };

/**
 * Which tabs make up the item's test cases. An explicit list from the user wins
 * (every entry must be a visible tab; an empty list means "none chosen yet").
 * Without one, a resubmission starts from the previous round's tabs, and a first
 * submission from the suggested tab (link gid, only tab, or key match).
 */
export function pickTabs(args: {
  tabs: TabInfo[];
  /** The user's explicit selection; undefined/null = not chosen yet. */
  requested?: string[] | null;
  /** Tabs of the item's latest round. */
  previous?: string[];
  gid?: number | null;
  jiraKey: string;
}): TabPick {
  const visible = new Set(args.tabs.filter((t) => !t.hidden).map((t) => t.title));
  const previous = args.previous ?? [];

  if (args.requested) {
    const unique = [...new Set(args.requested)];
    const bad = unique.find((t) => !visible.has(t));
    if (bad !== undefined) return { ok: false, missing: bad };
    return { ok: true, selected: unique, missingPrevious: previous.filter((t) => !visible.has(t)) };
  }

  const kept = previous.filter((t) => visible.has(t));
  if (kept.length > 0) return { ok: true, selected: kept, missingPrevious: previous.filter((t) => !visible.has(t)) };

  const suggested = chooseTab({ tabs: args.tabs, gid: args.gid, jiraKey: args.jiraKey });
  return { ok: true, selected: suggested ? [suggested] : [], missingPrevious: previous.filter((t) => !visible.has(t)) };
}
