import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userIntegrations } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";

export async function GET() {
  const user = await requireAuth();

  const [row] = await db
    .select({
      atlassianAccountId: userIntegrations.atlassianAccountId,
      atlassianEmail: userIntegrations.atlassianEmail,
      tokenExpiresAt: userIntegrations.tokenExpiresAt,
      updatedAt: userIntegrations.updatedAt,
    })
    .from(userIntegrations)
    .where(
      and(
        eq(userIntegrations.userId, user.id),
        eq(userIntegrations.provider, "atlassian")
      )
    )
    .limit(1);

  if (!row) {
    return Response.json({ connected: false });
  }

  return Response.json({
    connected: true,
    accountId: row.atlassianAccountId,
    email: row.atlassianEmail,
    tokenExpiresAt: row.tokenExpiresAt,
    connectedAt: row.updatedAt,
  });
}

export async function DELETE() {
  const user = await requireAuth();

  await db
    .delete(userIntegrations)
    .where(
      and(
        eq(userIntegrations.userId, user.id),
        eq(userIntegrations.provider, "atlassian")
      )
    );

  return Response.json({ success: true });
}
