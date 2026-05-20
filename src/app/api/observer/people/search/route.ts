import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/server";
import { sql } from "drizzle-orm";

export async function GET(req: Request) {
  try {
    await requireAuth();
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";

    if (q.length < 2) {
      return NextResponse.json([]);
    }

    // Search across board members and Jira issue assignees
    const term = `%${q.toLowerCase()}%`;

    const rows = await db.execute(sql`
      SELECT name, email, source
      FROM (
        SELECT DISTINCT ON (lower(email))
          name,
          email,
          'board_member' AS source
        FROM observer_board_members
        WHERE lower(name) LIKE ${term} OR lower(email) LIKE ${term}

        UNION ALL

        SELECT DISTINCT ON (lower(assignee_email))
          COALESCE(
            (custom_fields->>'assignee_display_name'),
            split_part(assignee_email, '@', 1)
          ) AS name,
          assignee_email AS email,
          'jira' AS source
        FROM jira_issues
        WHERE assignee_email IS NOT NULL
          AND (
            lower(assignee_email) LIKE ${term}
            OR lower(COALESCE(custom_fields->>'assignee_display_name', '')) LIKE ${term}
          )
      ) combined
      ORDER BY name
      LIMIT 15
    `);

    // Deduplicate by email (board_member preferred over jira)
    const seen = new Map<string, { name: string; email: string; source: string }>();
    for (const row of rows.rows as { name: string; email: string; source: string }[]) {
      const key = row.email.toLowerCase();
      if (!seen.has(key) || row.source === "board_member") {
        seen.set(key, row);
      }
    }

    return NextResponse.json([...seen.values()].slice(0, 12));
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
