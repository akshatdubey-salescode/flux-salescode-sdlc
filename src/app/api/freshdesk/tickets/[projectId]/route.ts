import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { freshdeskTickets } from "@/lib/db/schema";

export async function GET(
  _req: Request,
  props: { params: Promise<{ projectId: string }> }
) {
  await requireAuth();
  const { projectId } = await props.params;

  const tickets = await db
    .select()
    .from(freshdeskTickets)
    .where(eq(freshdeskTickets.projectId, projectId))
    .orderBy(desc(freshdeskTickets.fdCreatedAt));

  return NextResponse.json(tickets);
}
