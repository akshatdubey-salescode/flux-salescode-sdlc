import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/server";

export async function GET() {
  try {
    await requireAuth();

    const result = await db.execute(sql`
      SELECT DISTINCT
        assignee_email AS email,
        assignee_name AS name,
        assignee_account_id AS jira_account_id
      FROM jira_issues
      WHERE assignee_email IS NOT NULL
        AND assignee_name IS NOT NULL
      ORDER BY assignee_name ASC
    `);

    return NextResponse.json(
      result.rows as { email: string; name: string; jira_account_id: string | null }[]
    );
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
