import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { userIntegrations } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth/server";
import { syncUserCalendar } from "@/lib/google/calendar-sync";
import { userMeetingsTag } from "@/lib/google/cache-tags";

const BATCH_SIZE = 20;

export type CalendarSyncChunk = {
  type: "progress" | "done";
  processed: number;
  totalUsers: number;
  ok: number;
  skipped: number;
  errors: { userId: string; error: string }[];
  eventsUpserted: number;
  deletions: number;
};

export async function POST() {
  await requireRole("SUPERUSER");

  const connected = await db
    .select({ userId: userIntegrations.userId })
    .from(userIntegrations)
    .where(eq(userIntegrations.provider, "google"));

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const stats: Omit<CalendarSyncChunk, "type"> = {
        processed: 0,
        totalUsers: connected.length,
        ok: 0,
        skipped: 0,
        errors: [],
        eventsUpserted: 0,
        deletions: 0,
      };

      function emit(type: "progress" | "done") {
        controller.enqueue(encoder.encode(JSON.stringify({ type, ...stats }) + "\n"));
      }

      for (let i = 0; i < connected.length; i += BATCH_SIZE) {
        const batch = connected.slice(i, i + BATCH_SIZE);
        const settled = await Promise.allSettled(
          batch.map((row) => syncUserCalendar(row.userId))
        );
        for (let j = 0; j < settled.length; j++) {
          const s = settled[j];
          if (s.status === "fulfilled") {
            const r = s.value;
            if (r.status === "ok") {
              stats.ok++;
              stats.eventsUpserted += r.eventsUpserted;
              stats.deletions += r.deletions;
              if (r.eventsUpserted > 0 || r.deletions > 0) {
                revalidateTag(userMeetingsTag(r.userId), "max");
              }
            } else if (r.status === "skipped") {
              stats.skipped++;
            } else {
              stats.errors.push({ userId: r.userId, error: r.error });
            }
          } else {
            const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
            stats.errors.push({ userId: batch[j].userId, error: msg });
          }
        }
        stats.processed += batch.length;
        emit("progress");
      }

      emit("done");
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}
