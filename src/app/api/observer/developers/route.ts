import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/server";

export async function GET(req: NextRequest) {
  try {
    await requireAuth();

    const { searchParams } = req.nextUrl;
    const q = searchParams.get("q")?.trim() ?? "";
    const limit = Math.min(20, Math.max(1, parseInt(searchParams.get("limit") ?? "5", 10)));

    const result = await db.execute(sql`
      SELECT DISTINCT
        assignee_email AS email,
        assignee_name AS name,
        assignee_account_id AS jira_account_id
      FROM jira_issues
      WHERE assignee_email IS NOT NULL
        AND assignee_name IS NOT NULL
        ${q ? sql`AND (assignee_name ILIKE ${"%" + q + "%"} OR assignee_email ILIKE ${"%" + q + "%"})` : sql``}
      ORDER BY assignee_name ASC
      LIMIT ${limit}
    `);

    return NextResponse.json(
      result.rows as { email: string; name: string; jira_account_id: string | null }[]
    );
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
