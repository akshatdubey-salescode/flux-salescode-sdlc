import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/server";

function todayUtc(): string {
  return new Date().toISOString().split("T")[0];
}

export async function GET() {
  try {
    const user = await requireAuth();
    const today = todayUtc();

    const rows = await db.execute(sql`
      SELECT
        ji.id,
        ji.jira_key,
        ji.summary,
        ji.status,
        ji.status_category,
        ji.priority,
        ji.jira_updated_at,
        jp.name             AS project_name,
        jp.jira_project_key AS project_key
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id
      LEFT JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
      LEFT JOIN engineer_work_declarations ewd
        ON ewd.jira_issue_id = ji.id
        AND ewd.engineer_email = ${user.email}
        AND ewd.declared_date = ${today}::date
      WHERE ji.assignee_email = ${user.email}
        AND (psm.canonical_status IS NULL OR psm.canonical_status NOT IN ('DONE', 'CANCELLED'))
        AND ewd.id IS NULL
      ORDER BY
        CASE ji.priority
          WHEN 'Critical'  THEN 1
          WHEN 'Highest'   THEN 2
          WHEN 'High'      THEN 3
          WHEN 'Medium'    THEN 4
          WHEN 'Low'       THEN 5
          WHEN 'Lowest'    THEN 6
          ELSE 7
        END,
        ji.jira_updated_at DESC NULLS LAST
    `);

    return NextResponse.json(rows.rows);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
