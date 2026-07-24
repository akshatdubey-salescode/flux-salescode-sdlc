import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";
import { KEKA_DIRECTORY_TAG } from "@/lib/keka/cache-tags";

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = req.nextUrl;
    const q = searchParams.get("q")?.trim() ?? "";
    const limit = Math.min(20, Math.max(1, parseInt(searchParams.get("limit") ?? "5", 10)));
    return NextResponse.json(await fetchDevelopers(q, limit));
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

async function fetchDevelopers(q: string, limit: number) {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues", KEKA_DIRECTORY_TAG);

  // Primary source: the synced Keka employee directory (keka_employees only
  // ever holds active/current staff — see src/lib/keka/directory.ts). This is
  // who should show up here by default: real, currently-employed people,
  // regardless of whether Jira happens to have assigned/reported an issue to
  // them. Previously this endpoint derived its entire list from Jira
  // assignee/reporter columns, which missed anyone whose Jira activity didn't
  // happen to cover both roles (e.g. a logged-in user who'd only ever been a
  // reporter, or a brand-new hire with no Jira history yet).
  //
  // Jira is still consulted for two things: (1) opportunistically resolving a
  // jira_account_id for a Keka employee, needed by callers like the Team
  // Pulse "add member" flow; (2) a fallback list of anyone found only via
  // Jira assignee/reporter columns who has no Keka record at all (contractors
  // / vendors on the Jira side without an HR record) — so switching sources
  // doesn't make a previously-searchable person disappear.
  const nameFilter = q ? sql`AND (name ILIKE ${"%" + q + "%"} OR email ILIKE ${"%" + q + "%"})` : sql``;
  const result = await db.execute(sql`
    WITH keka_people AS (
      SELECT
        ke.email AS email,
        COALESCE(NULLIF(ke.display_name, ''), ke.email) AS name,
        jira_ids.jira_account_id
      FROM keka_employees ke
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          (SELECT ji.assignee_account_id FROM jira_issues ji
           WHERE lower(ji.assignee_email) = ke.email AND ji.assignee_account_id IS NOT NULL
           LIMIT 1),
          (SELECT ji.reporter_account_id FROM jira_issues ji
           WHERE lower(ji.reporter_email) = ke.email AND ji.reporter_account_id IS NOT NULL
           LIMIT 1)
        ) AS jira_account_id
      ) jira_ids ON true
      WHERE ke.email IS NOT NULL
    ),
    jira_only AS (
      SELECT DISTINCT ON (email)
        email, name, jira_account_id
      FROM (
        SELECT lower(assignee_email) AS email, assignee_name AS name, assignee_account_id AS jira_account_id
        FROM jira_issues
        WHERE assignee_email IS NOT NULL AND assignee_name IS NOT NULL
        UNION ALL
        SELECT lower(reporter_email) AS email, reporter_name AS name, reporter_account_id AS jira_account_id
        FROM jira_issues
        WHERE reporter_email IS NOT NULL AND reporter_name IS NOT NULL
      ) combined
      WHERE NOT EXISTS (SELECT 1 FROM keka_employees ke WHERE ke.email = combined.email)
      ORDER BY email, jira_account_id NULLS LAST
    ),
    combined_people AS (
      SELECT DISTINCT ON (email) email, name, jira_account_id
      FROM (
        SELECT * FROM keka_people
        UNION ALL
        SELECT * FROM jira_only
      ) both_sources
      ORDER BY email, jira_account_id NULLS LAST
    )
    SELECT email, name, jira_account_id
    FROM combined_people
    WHERE TRUE ${nameFilter}
    ORDER BY name ASC
    LIMIT ${limit}
  `);

  return result.rows as { email: string; name: string; jira_account_id: string | null }[];
}
