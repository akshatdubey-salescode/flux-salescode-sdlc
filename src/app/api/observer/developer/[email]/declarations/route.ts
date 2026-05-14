import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/server";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { ensureCarryoverDeclarations } from "@/lib/observer/carryover";

type Params = { params: Promise<{ email: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    await requireAuth();
    const { email } = await params;
    const decodedEmail = decodeURIComponent(email).toLowerCase();

    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get("days") ?? "14", 10), 1), 90);
    const stalenessThreshold = Math.min(
      Math.max(parseInt(searchParams.get("stalenessThreshold") ?? "5", 10), 1),
      90
    );

    const today = new Date().toISOString().split("T")[0];
    const staleCutoff = new Date();
    staleCutoff.setDate(staleCutoff.getDate() - stalenessThreshold);
    const staleCutoffStr = staleCutoff.toISOString().split("T")[0];

    await ensureCarryoverDeclarations(decodedEmail, today);

    const [todayDecls, pendingQueue, history] = await Promise.all([
      db.execute(sql`
        SELECT
          ewd.id,
          ewd.comment,
          ewd.expected_completion_date,
          ewd.created_at,
          ewd.updated_at,
          ji.id              AS jira_issue_id,
          ji.jira_key,
          ji.summary,
          ji.status,
          ji.status_category,
          ji.priority,
          jp.name            AS project_name,
          jp.jira_project_key AS project_key
        FROM engineer_work_declarations ewd
        JOIN jira_issues ji ON ji.id = ewd.jira_issue_id
        JOIN jira_projects jp ON jp.id = ji.project_id
        WHERE ewd.engineer_email = ${decodedEmail}
          AND ewd.declared_date = ${today}::date
        ORDER BY ewd.created_at ASC
      `),

      db.execute(sql`
        SELECT
          ji.id,
          ji.jira_key,
          ji.summary,
          ji.status,
          ji.status_category,
          ji.priority,
          ji.jira_updated_at,
          jp.name             AS project_name,
          jp.jira_project_key AS project_key,
          (today_decl.id IS NOT NULL) AS declared_today,
          (
            psm.canonical_status = 'IN_PROGRESS'
            AND NOT EXISTS (
              SELECT 1 FROM engineer_work_declarations ewd2
              WHERE ewd2.jira_issue_id = ji.id
                AND ewd2.engineer_email = ${decodedEmail}
                AND ewd2.declared_date >= ${staleCutoffStr}::date
            )
          ) AS possibly_stalled
        FROM jira_issues ji
        JOIN jira_projects jp ON jp.id = ji.project_id
        LEFT JOIN project_status_mappings psm
          ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
        LEFT JOIN engineer_work_declarations today_decl
          ON today_decl.jira_issue_id = ji.id
          AND today_decl.engineer_email = ${decodedEmail}
          AND today_decl.declared_date = ${today}::date
        WHERE ji.assignee_email = ${decodedEmail}
          AND (psm.canonical_status IS NULL OR psm.canonical_status NOT IN ('DONE', 'CANCELLED'))
        ORDER BY
          (today_decl.id IS NOT NULL) DESC,
          CASE ji.priority
            WHEN 'Critical' THEN 1
            WHEN 'Highest'  THEN 2
            WHEN 'High'     THEN 3
            WHEN 'Medium'   THEN 4
            WHEN 'Low'      THEN 5
            WHEN 'Lowest'   THEN 6
            ELSE 7
          END,
          ji.jira_updated_at DESC NULLS LAST
      `),

      db.execute(sql`
        SELECT
          ewd.declared_date::text AS declared_date,
          ewd.id,
          ewd.comment,
          ewd.expected_completion_date,
          ewd.created_at,
          ewd.updated_at,
          ji.jira_key,
          ji.summary,
          ji.status,
          ji.status_category,
          ji.priority,
          jp.name AS project_name
        FROM engineer_work_declarations ewd
        JOIN jira_issues ji ON ji.id = ewd.jira_issue_id
        JOIN jira_projects jp ON jp.id = ji.project_id
        WHERE ewd.engineer_email = ${decodedEmail}
          AND ewd.declared_date >= CURRENT_DATE - (${days} * INTERVAL '1 day')
        ORDER BY ewd.declared_date DESC, ewd.created_at ASC
      `),
    ]);

    type HistoryRow = {
      declared_date: string;
      id: string;
      comment: string | null;
      expected_completion_date: string | null;
      created_at: string;
      updated_at: string;
      jira_key: string;
      summary: string;
      status: string;
      status_category: string | null;
      priority: string | null;
      project_name: string;
    };

    const historyByDate = new Map<string, HistoryRow[]>();
    for (const row of history.rows as HistoryRow[]) {
      const list = historyByDate.get(row.declared_date) ?? [];
      list.push(row);
      historyByDate.set(row.declared_date, list);
    }

    const groupedHistory = Array.from(historyByDate.entries()).map(([date, rows]) => ({
      date,
      declarations: rows,
    }));

    return NextResponse.json({
      todayDeclarations: todayDecls.rows,
      pendingQueue: pendingQueue.rows,
      declarationHistory: groupedHistory,
    });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    console.error("[declarations] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
