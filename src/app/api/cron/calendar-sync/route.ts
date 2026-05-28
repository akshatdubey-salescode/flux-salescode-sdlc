import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { userIntegrations } from "@/lib/db/schema";
import { syncUserCalendar, type SyncOutcome } from "@/lib/google/calendar-sync";
import { userMeetingsTag } from "@/lib/google/cache-tags";

// Run all users in chunks instead of sequentially or all-at-once.
// 20 keeps us well under any Google per-minute project quota and bounds
// function memory while still finishing 200 users in ~10 batches.
const BATCH_SIZE = 20;

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return auth === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connected = await db
    .select({ userId: userIntegrations.userId })
    .from(userIntegrations)
    .where(eq(userIntegrations.provider, "google"));

  const stats = {
    totalUsers: connected.length,
    ok: 0,
    skipped: 0,
    errors: [] as { userId: string; error: string }[],
    eventsUpserted: 0,
    deletions: 0,
  };

  for (let i = 0; i < connected.length; i += BATCH_SIZE) {
    const batch = connected.slice(i, i + BATCH_SIZE);
    // allSettled — a single user's decrypt failure or refresh exception must
    // not abort the rest of the batch. syncUserCalendar normally returns a
    // SyncOutcome, but anything thrown by getValidAccessToken (e.g. decrypt
    // mismatch on a legacy/rotated key) escapes its try/catch.
    const settled = await Promise.allSettled(
      batch.map((row) => syncUserCalendar(row.userId))
    );
    for (let j = 0; j < settled.length; j++) {
      const s = settled[j];
      if (s.status === "fulfilled") {
        const r = s.value;
        tally(r, stats);
        // Only invalidate when the user's data actually changed; skipped /
        // error outcomes leave the cache valid so a transient Google blip
        // doesn't force a stampede of refetches.
        if (r.status === "ok" && (r.eventsUpserted > 0 || r.deletions > 0)) {
          revalidateTag(userMeetingsTag(r.userId), "max");
        }
      } else {
        const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
        stats.errors.push({ userId: batch[j].userId, error: msg });
      }
    }
  }

  return Response.json(stats);
}

function tally(r: SyncOutcome, stats: {
  ok: number;
  skipped: number;
  errors: { userId: string; error: string }[];
  eventsUpserted: number;
  deletions: number;
}) {
  if (r.status === "ok") {
    stats.ok++;
    stats.eventsUpserted += r.eventsUpserted;
    stats.deletions += r.deletions;
  } else if (r.status === "skipped") {
    stats.skipped++;
  } else {
    stats.errors.push({ userId: r.userId, error: r.error });
  }
}
