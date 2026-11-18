// The pure decisions behind keeping the AI review's guidelines library in step with Confluence: when a saved page
// must be re-read, when a section's sub-pages must be listed again, and which listed pages are new. No I/O here.

/** A page confirmed up to date this recently is used as is, so several reviews started together don't all ask Confluence. */
export const VERSION_CHECK_MS = 60 * 1000;
/** How often a section's sub-pages are listed again (one listing walks the whole section, so not on every review). */
export const CHILDREN_SYNC_MS = 5 * 60 * 1000;

/** Whether the saved copy should be compared with Confluence now. */
export function versionCheckDue(fetchedAt: Date | null, now: number): boolean {
  return !fetchedAt || now - fetchedAt.getTime() >= VERSION_CHECK_MS;
}

/** Whether the page text must be fetched again: Confluence has another version, or the last read failed (retry). */
export function needsFullRefresh(args: { savedVersion: number; remoteVersion: number; lastError: string | null }): boolean {
  return args.lastError !== null || args.remoteVersion !== args.savedVersion;
}

/** Whether a section's sub-pages should be listed again. */
export function childrenSyncDue(childrenSyncedAt: Date | null, now: number): boolean {
  return !childrenSyncedAt || now - childrenSyncedAt.getTime() >= CHILDREN_SYNC_MS;
}

/**
 * Which of the listed sub-pages are new to the library, in reading order, and how many did not fit because the library
 * is full. `knownPageIds` are the Confluence ids already in the library.
 */
export function planNewChildren<T extends { id: string }>(
  listed: T[],
  knownPageIds: ReadonlySet<string>,
  room: number,
): { toAdd: T[]; skipped: number } {
  const fresh = listed.filter((c) => !knownPageIds.has(c.id));
  const cap = Math.max(0, room);
  return { toAdd: fresh.slice(0, cap), skipped: Math.max(0, fresh.length - cap) };
}

/**
 * Fits pages into a size budget, in the given order (most important first). A page that does not fit whole is left
 * out rather than cut in the middle, and the pages after it still get their chance with what space remains.
 */
export function packPages<T extends { chars: number }>(ordered: T[], budget: number): { fit: T[]; omitted: T[] } {
  const fit: T[] = [];
  const omitted: T[] = [];
  let left = budget;
  for (const page of ordered) {
    if (page.chars > 0 && page.chars <= left) {
      fit.push(page);
      left -= page.chars;
    } else if (page.chars > 0) {
      omitted.push(page);
    }
  }
  return { fit, omitted };
}

/** The pages in their new order after moving one up or down by one place (no change at the ends). */
export function movePage<T>(ordered: T[], index: number, direction: "up" | "down"): T[] {
  const to = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= ordered.length || to < 0 || to >= ordered.length) return ordered;
  const next = [...ordered];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}
