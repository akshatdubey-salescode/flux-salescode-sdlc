import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendarEvents, userIntegrations } from "@/lib/db/schema";
import { getValidAccessToken } from "@/lib/google/oauth";

const CALENDAR_LIST_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

// How far back to look on the very first sync (or after a syncToken expiry).
const INITIAL_WINDOW_DAYS = 7;

// ---------------------------------------------------------------------------
// Google event shape (only the fields we read).
// ---------------------------------------------------------------------------

type GoogleEventDateTime = {
  date?: string; // YYYY-MM-DD for all-day events
  dateTime?: string; // RFC3339
  timeZone?: string;
};

type GoogleEvent = {
  id: string;
  iCalUID?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  visibility?: "default" | "public" | "private" | "confidential";
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  organizer?: { email?: string; self?: boolean };
  attendees?: { email?: string; responseStatus?: string }[];
  htmlLink?: string;
};

type GoogleEventListResponse = {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type SyncOutcome =
  | { status: "ok"; userId: string; eventsUpserted: number; deletions: number }
  | { status: "skipped"; userId: string; reason: string }
  | { status: "error"; userId: string; error: string };

/**
 * Sync one user's primary calendar.
 *
 * Strategy:
 *   - If we have a stored syncToken, do an incremental sync.
 *   - On 410 GONE the token is expired; reset and fall back to a time-window
 *     full sync over the initial window. Google requires you to drop the
 *     syncToken before falling back.
 *   - On first run (no token), do a time-window pull and capture the
 *     nextSyncToken from the final page for next time.
 */
export async function syncUserCalendar(userId: string): Promise<SyncOutcome> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    return { status: "skipped", userId, reason: "no_valid_token" };
  }

  const [row] = await db
    .select({ googleSyncToken: userIntegrations.googleSyncToken })
    .from(userIntegrations)
    .where(
      and(
        eq(userIntegrations.userId, userId),
        eq(userIntegrations.provider, "google")
      )
    )
    .limit(1);

  let syncToken = row?.googleSyncToken ?? null;
  let eventsUpserted = 0;
  let deletions = 0;

  try {
    const result = await fetchAndApply(userId, accessToken, syncToken);
    eventsUpserted = result.eventsUpserted;
    deletions = result.deletions;
    syncToken = result.nextSyncToken ?? syncToken;
  } catch (err) {
    if (err instanceof SyncTokenExpired) {
      // Fall back to a clean full-window sync.
      await db
        .update(userIntegrations)
        .set({ googleSyncToken: null })
        .where(
          and(
            eq(userIntegrations.userId, userId),
            eq(userIntegrations.provider, "google")
          )
        );
      const result = await fetchAndApply(userId, accessToken, null);
      eventsUpserted = result.eventsUpserted;
      deletions = result.deletions;
      syncToken = result.nextSyncToken ?? null;
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "error", userId, error: msg };
    }
  }

  await db
    .update(userIntegrations)
    .set({
      googleSyncToken: syncToken,
      googleLastSyncedAt: new Date(),
    })
    .where(
      and(
        eq(userIntegrations.userId, userId),
        eq(userIntegrations.provider, "google")
      )
    );

  return { status: "ok", userId, eventsUpserted, deletions };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

class SyncTokenExpired extends Error {
  constructor() {
    super("Sync token expired (410 GONE)");
    this.name = "SyncTokenExpired";
  }
}

type ApplyResult = {
  eventsUpserted: number;
  deletions: number;
  nextSyncToken: string | null;
};

async function fetchAndApply(
  userId: string,
  accessToken: string,
  syncToken: string | null
): Promise<ApplyResult> {
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;
  let eventsUpserted = 0;
  let deletions = 0;

  do {
    const url = new URL(CALENDAR_LIST_URL);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("maxResults", "250");

    if (syncToken) {
      url.searchParams.set("syncToken", syncToken);
    } else {
      // Google quirk: nextSyncToken is omitted when orderBy is set, so the
      // initial pull has to be unordered. We sort locally after upserting.
      const now = Date.now();
      url.searchParams.set(
        "timeMin",
        new Date(now - INITIAL_WINDOW_DAYS * 86_400_000).toISOString()
      );
      url.searchParams.set("timeMax", new Date(now).toISOString());
    }
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 410) throw new SyncTokenExpired();
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Calendar list failed (${res.status}): ${text}`);
    }

    const body = (await res.json()) as GoogleEventListResponse;
    const items = body.items ?? [];

    for (const ev of items) {
      if (ev.status === "cancelled") {
        const del = await db
          .delete(calendarEvents)
          .where(
            and(
              eq(calendarEvents.userId, userId),
              eq(calendarEvents.googleEventId, ev.id)
            )
          )
          .returning({ id: calendarEvents.id });
        deletions += del.length;
        continue;
      }

      const parsed = parseEventTimes(ev);
      if (!parsed) continue; // malformed — skip silently

      const attendeeEmails =
        ev.attendees
          ?.map((a) => a.email?.toLowerCase())
          .filter((e): e is string => Boolean(e)) ?? [];

      // Respect the user's visibility setting: don't store summaries for
      // private / confidential events. The time block is still recorded so
      // managers see "Busy" without the title leaking.
      const visibility = ev.visibility ?? "default";
      const summary =
        visibility === "private" || visibility === "confidential"
          ? null
          : ev.summary ?? null;

      await db
        .insert(calendarEvents)
        .values({
          userId,
          googleEventId: ev.id,
          iCalUid: ev.iCalUID ?? null,
          summary,
          visibility,
          status: ev.status ?? null,
          startsAt: parsed.startsAt,
          endsAt: parsed.endsAt,
          isAllDay: parsed.isAllDay,
          organizerEmail: ev.organizer?.email?.toLowerCase() ?? null,
          attendeeEmails,
          htmlLink: ev.htmlLink ?? null,
        })
        .onConflictDoUpdate({
          target: [calendarEvents.userId, calendarEvents.googleEventId],
          set: {
            iCalUid: ev.iCalUID ?? null,
            summary,
            visibility,
            status: ev.status ?? null,
            startsAt: parsed.startsAt,
            endsAt: parsed.endsAt,
            isAllDay: parsed.isAllDay,
            organizerEmail: ev.organizer?.email?.toLowerCase() ?? null,
            attendeeEmails,
            htmlLink: ev.htmlLink ?? null,
            syncedAt: new Date(),
          },
        });
      eventsUpserted++;
    }

    pageToken = body.nextPageToken;
    if (!pageToken && body.nextSyncToken) {
      nextSyncToken = body.nextSyncToken;
    }
  } while (pageToken);

  return { eventsUpserted, deletions, nextSyncToken };
}

function parseEventTimes(
  ev: GoogleEvent
): { startsAt: Date; endsAt: Date; isAllDay: boolean } | null {
  const start = ev.start;
  const end = ev.end;
  if (!start || !end) return null;

  if (start.date && end.date) {
    // All-day event: Google returns end exclusive.
    const startsAt = new Date(`${start.date}T00:00:00Z`);
    const endsAt = new Date(`${end.date}T00:00:00Z`);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      return null;
    }
    return { startsAt, endsAt, isAllDay: true };
  }

  if (start.dateTime && end.dateTime) {
    const startsAt = new Date(start.dateTime);
    const endsAt = new Date(end.dateTime);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      return null;
    }
    return { startsAt, endsAt, isAllDay: false };
  }

  return null;
}
