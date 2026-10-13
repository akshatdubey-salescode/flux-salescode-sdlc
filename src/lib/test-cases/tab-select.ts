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
