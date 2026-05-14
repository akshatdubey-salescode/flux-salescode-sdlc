import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { observerBoards, observerBoardMembers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/server";
import { ensureCarryoverDeclarations } from "@/lib/observer/carryover";

type Params = { params: Promise<{ boardId: string }> };

function loadLabel(score: number): "Free" | "Light" | "Moderate" | "Heavy" {
  if (score === 0) return "Free";
  if (score <= 2) return "Light";
  if (score <= 4) return "Moderate";
  return "Heavy";
}

function loadScore(
  declarations: { priority: string | null }[]
): number {
  return declarations.reduce((sum, d) => {
    const p = d.priority?.toLowerCase() ?? "";
    return sum + (p === "critical" || p === "highest" ? 2 : 1);
  }, 0);
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const user = await requireAuth();
    const { boardId } = await params;

    const [board] = await db
      .select()
      .from(observerBoards)
      .where(and(eq(observerBoards.id, boardId), eq(observerBoards.createdBy, user.id)));

    if (!board) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const members = await db
      .select()
      .from(observerBoardMembers)
      .where(eq(observerBoardMembers.boardId, boardId));

    if (members.length === 0) {
      return NextResponse.json([]);
    }

    const today = new Date().toISOString().split("T")[0];

    // Materialize carryovers for all members in parallel
    await Promise.all(
      members.map((m) => ensureCarryoverDeclarations(m.email, today))
    );

    const emails = members.map((m) => m.email);
    const emailsIn = sql.join(emails.map((e) => sql`${e}`), sql`, `);

    const staleCutoff = new Date();
    staleCutoff.setDate(staleCutoff.getDate() - board.stalenessThresholdDays);
    const staleCutoffStr = staleCutoff.toISOString().split("T")[0];

    const declarationsRes = await db.execute(sql`
      SELECT
        ewd.id             AS declaration_id,
        ewd.engineer_email,
        ewd.comment,
        ewd.expected_completion_date,
        ewd.created_at     AS declared_at,
        ewd.updated_at,
        ji.id              AS jira_issue_id,
        ji.jira_key,
        ji.summary,
        ji.status,
        ji.status_category,
        ji.priority,
        jp.name            AS project_name,
        jp.jira_base_url   AS jira_base_url
      FROM engineer_work_declarations ewd
      JOIN jira_issues ji ON ji.id = ewd.jira_issue_id
      JOIN jira_projects jp ON jp.id = ji.project_id
      WHERE ewd.engineer_email IN (${emailsIn})
        AND ewd.declared_date = CURRENT_DATE
      ORDER BY ewd.engineer_email, ewd.created_at
    `);

    const pendingRes = await db.execute(sql`
      SELECT
        ji.assignee_email,
        COUNT(*)::int AS pending_count
      FROM jira_issues ji
      LEFT JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
      LEFT JOIN engineer_work_declarations ewd
        ON ewd.jira_issue_id = ji.id
        AND ewd.engineer_email = ji.assignee_email
        AND ewd.declared_date = CURRENT_DATE
      WHERE ji.assignee_email IN (${emailsIn})
        AND (psm.canonical_status IS NULL OR psm.canonical_status NOT IN ('DONE', 'CANCELLED'))
        AND ewd.id IS NULL
      GROUP BY ji.assignee_email
    `);

    const lastCheckInRes = await db.execute(sql`
      SELECT
        engineer_email,
        MAX(declared_date)::text AS last_check_in_date,
        MAX(created_at)          AS last_check_in_at
      FROM engineer_work_declarations
      WHERE engineer_email IN (${emailsIn})
      GROUP BY engineer_email
    `);

    const stalledRes = await db.execute(sql`
      SELECT
        ji.assignee_email,
        COUNT(*)::int AS stalled_count
      FROM jira_issues ji
      JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
      WHERE ji.assignee_email IN (${emailsIn})
        AND psm.canonical_status = 'IN_PROGRESS'
        AND NOT EXISTS (
          SELECT 1 FROM engineer_work_declarations ewd
          WHERE ewd.jira_issue_id = ji.id
            AND ewd.engineer_email = ji.assignee_email
            AND ewd.declared_date >= ${staleCutoffStr}::date
        )
      GROUP BY ji.assignee_email
    `);

    type DeclarationRow = {
      declaration_id: string;
      engineer_email: string;
      comment: string | null;
      expected_completion_date: string | null;
      declared_at: string;
      updated_at: string;
      jira_issue_id: string;
      jira_key: string;
      summary: string;
      status: string;
      status_category: string | null;
      priority: string | null;
      project_name: string;
      jira_base_url: string;
    };
    type PendingRow = { assignee_email: string; pending_count: number };
    type LastCheckInRow = { engineer_email: string; last_check_in_date: string | null; last_check_in_at: string | null };
    type StalledRow = { assignee_email: string; stalled_count: number };

    const declsByEmail = new Map<string, DeclarationRow[]>();
    for (const row of declarationsRes.rows as DeclarationRow[]) {
      const list = declsByEmail.get(row.engineer_email) ?? [];
      list.push(row);
      declsByEmail.set(row.engineer_email, list);
    }

    const pendingByEmail = new Map<string, number>();
    for (const row of pendingRes.rows as PendingRow[]) {
      pendingByEmail.set(row.assignee_email, row.pending_count);
    }

    const lastCheckInByEmail = new Map<string, LastCheckInRow>();
    for (const row of lastCheckInRes.rows as LastCheckInRow[]) {
      lastCheckInByEmail.set(row.engineer_email, row);
    }

    const stalledByEmail = new Map<string, number>();
    for (const row of stalledRes.rows as StalledRow[]) {
      stalledByEmail.set(row.assignee_email, row.stalled_count);
    }

    const pulse = members.map((member) => {
      const decls = declsByEmail.get(member.email) ?? [];
      const score = loadScore(decls);
      const checkIn = lastCheckInByEmail.get(member.email);

      return {
        memberId: member.id,
        name: member.name,
        email: member.email,
        loadScore: score,
        loadLabel: loadLabel(score),
        activeDeclarations: decls.map((d) => ({
          declarationId: d.declaration_id,
          jiraIssueId: d.jira_issue_id,
          jiraKey: d.jira_key,
          summary: d.summary,
          status: d.status,
          statusCategory: d.status_category,
          priority: d.priority,
          projectName: d.project_name,
          jiraBaseUrl: d.jira_base_url,
          comment: d.comment,
          expectedCompletionDate: d.expected_completion_date,
          declaredAt: d.declared_at,
          updatedAt: d.updated_at,
        })),
        pendingQueueCount: pendingByEmail.get(member.email) ?? 0,
        stalledCount: stalledByEmail.get(member.email) ?? 0,
        lastCheckInDate: checkIn?.last_check_in_date ?? null,
        lastCheckInAt: checkIn?.last_check_in_at ?? null,
        checkedInToday: (checkIn?.last_check_in_date ?? null) === today,
      };
    });

    pulse.sort((a, b) => {
      const order = { Heavy: 0, Moderate: 1, Light: 2, Free: 3 };
      const diff = order[a.loadLabel] - order[b.loadLabel];
      if (diff !== 0) return diff;
      return b.stalledCount - a.stalledCount;
    });

    return NextResponse.json(pulse);
  } catch (err) {
    console.error("[pulse] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
