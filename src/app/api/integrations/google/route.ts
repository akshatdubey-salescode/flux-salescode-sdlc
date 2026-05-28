import { and, eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { userIntegrations, calendarEvents } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { deleteIntegration } from "@/lib/google/oauth";
import { userMeetingsTag } from "@/lib/google/calendar-sync";

export async function GET() {
  const user = await requireAuth();

  const [row] = await db
    .select({
      googleEmail: userIntegrations.googleEmail,
      tokenExpiresAt: userIntegrations.tokenExpiresAt,
      googleLastSyncedAt: userIntegrations.googleLastSyncedAt,
      updatedAt: userIntegrations.updatedAt,
    })
    .from(userIntegrations)
    .where(
      and(
        eq(userIntegrations.userId, user.id),
        eq(userIntegrations.provider, "google")
      )
    )
    .limit(1);

  if (!row) return Response.json({ connected: false });

  return Response.json({
    connected: true,
    email: row.googleEmail,
    tokenExpiresAt: row.tokenExpiresAt,
    lastSyncedAt: row.googleLastSyncedAt,
    connectedAt: row.updatedAt,
  });
}

export async function DELETE() {
  const user = await requireAuth();
  // Remove stored events too — leaving them as ghosts behind a disconnected
  // integration violates the user's "stop tracking my calendar" intent and
  // would still surface on observer boards.
  await db.delete(calendarEvents).where(eq(calendarEvents.userId, user.id));
  await deleteIntegration(user.id);
  revalidateTag(userMeetingsTag(user.id), "max");
  return Response.json({ success: true });
}
