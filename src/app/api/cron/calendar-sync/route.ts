import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userIntegrations } from "@/lib/db/schema";
import { syncUserCalendar, type SyncOutcome } from "@/lib/google/calendar-sync";

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
    const results = await Promise.all(
      batch.map((row) => syncUserCalendar(row.userId))
    );
    for (const r of results) tally(r, stats);
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
