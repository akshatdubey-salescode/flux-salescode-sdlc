// One source per item. The first commit fixes whether an item's test cases
// come from a Google Sheet (and which one) or from an uploaded workbook; every
// later commit (a resubmission) and every sign-off must use that same source.
// Edits happen in the same sheet; extra test cases are added there, on its
// existing or new tabs. Starting over needs an admin to delete the item's TCs.

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tcRounds, tcSets } from "@/lib/db/schema";
import type { Executor } from "./concurrency";
import type { RoundScope } from "./scope";
import type { TcSource } from "./values";

export type ItemLock = {
  source: TcSource;
  /** Google Sheet only: the fixed link and spreadsheet. */
  sheetUrl: string | null;
  spreadsheetId: string | null;
  /** Tabs of the latest round: what the next round starts from and what sign-off reads. */
  tabs: string[];
  /** The latest round's number (so the UI can say "resubmitting as Round N+1"). */
  roundNo: number;
  /** Which tabs and rows the latest round reviewed (null for rounds from before rows could be chosen: every row). */
  scope: RoundScope | null;
};

export class SourceLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceLockedError";
  }
}

export type LockVerdict = { ok: true } | { ok: false; reason: string };

const START_OVER = "To start over with a different source, an admin has to delete this item's test cases first.";

/** Pure: may a submission with this source/spreadsheet be added to an item with this lock? */
export function checkLock(lock: ItemLock | null, incoming: { source: TcSource; spreadsheetId: string | null }): LockVerdict {
  if (!lock) return { ok: true };
  if (incoming.source !== lock.source) {
    return {
      ok: false,
      reason:
        lock.source === "google_sheet"
          ? `This item's test cases come from a Google Sheet, so an Excel upload can't be added. Edit the sheet and resubmit. ${START_OVER}`
          : `This item's test cases come from an Excel upload, so a Google Sheet can't be added. Download the current workbook, edit it and upload it again. ${START_OVER}`,
    };
  }
  if (lock.source === "google_sheet" && incoming.spreadsheetId !== lock.spreadsheetId) {
    return {
      ok: false,
      reason: `This item already uses a different Google Sheet (${lock.sheetUrl ?? "the first one submitted"}). Add extra test cases there, on the same or a new tab, and resubmit. ${START_OVER}`,
    };
  }
  return { ok: true };
}

/** The item's lock, or null when nothing has been submitted yet. */
export async function getItemLock(issueId: string, ex: Executor = db): Promise<ItemLock | null> {
  const rounds = await ex
    .select({
      roundNo: tcRounds.roundNo,
      source: tcRounds.source,
      sheetUrl: tcRounds.sheetUrl,
      spreadsheetId: tcRounds.spreadsheetId,
      sheetTab: tcRounds.sheetTab,
      sheetTabs: tcRounds.sheetTabs,
      scope: tcRounds.scope,
    })
    .from(tcRounds)
    .innerJoin(tcSets, eq(tcSets.id, tcRounds.setId))
    .where(eq(tcSets.issueId, issueId))
    .orderBy(asc(tcRounds.roundNo));
  if (rounds.length === 0) return null;
  const first = rounds[0];
  const latest = rounds[rounds.length - 1];
  const tabs = latest.sheetTabs.length > 0 ? latest.sheetTabs : latest.sheetTab ? [latest.sheetTab] : [];
  return { source: first.source, sheetUrl: first.sheetUrl, spreadsheetId: first.spreadsheetId, tabs, roundNo: latest.roundNo, scope: latest.scope ?? null };
}
