import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { requireAuth } from "@/lib/auth/server";
import { KEKA_DIRECTORY_TAG } from "@/lib/keka/cache-tags";

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(20, Math.max(1, parseInt(searchParams.get("limit") ?? "5", 10)));
  try {
    return NextResponse.json(await fetchDevelopers(q, limit));
  } catch (e) {
    // Previously this shared a catch block with the auth check above, so any
    // query bug here was silently reported as "Unauthorized" — impossible
    // to tell the two apart from the client, and nothing was ever logged.
    console.error("[observer/developers] fetchDevelopers failed:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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
  //
  // Performance: the name/email filter must be applied INSIDE each source's
  // own query, not after combining — and the jira_account_id LATERAL lookup
  // must run only on the final LIMITed rows, not on every Keka employee.
  // Measured via EXPLAIN ANALYZE against the live dataset (233 Keka
  // employees, ~56k jira_issues): filtering after combining, plus resolving
  // jira_account_id via a per-employee LATERAL over all 233 rows, cost
  // ~4.2s per search — the LATERAL's lower(assignee_email)/lower(reporter_
  // email) predicates couldn't use the plain btree indexes on those columns
  // (stored mixed-case, see sync.ts), forcing a full sequential scan of
  // jira_issues once per employee. Pushing the filter down + limiting
  // before the LATERAL, plus adding the expression indexes in schema.ts
  // (jira_issues_assignee_email_lower_idx / _reporter_email_lower_idx) so
  // the LATERAL is an index scan when it does run, brought this down to
  // ~100ms.
  const kekaFilter = q
    ? sql`AND (COALESCE(NULLIF(ke.display_name, ''), ke.email) ILIKE ${"%" + q + "%"} OR ke.email ILIKE ${"%" + q + "%"})`
    : sql``;
  const assigneeFilter = q ? sql`AND (assignee_name ILIKE ${"%" + q + "%"} OR assignee_email ILIKE ${"%" + q + "%"})` : sql``;
  const reporterFilter = q ? sql`AND (reporter_name ILIKE ${"%" + q + "%"} OR reporter_email ILIKE ${"%" + q + "%"})` : sql``;

  const result = await db.execute(sql`
    WITH keka_people AS (
      SELECT
        ke.email AS email,
        COALESCE(NULLIF(ke.display_name, ''), ke.email) AS name,
        NULL::text AS jira_account_id
      FROM keka_employees ke
      WHERE ke.email IS NOT NULL ${kekaFilter}
    ),
    jira_only AS (
      SELECT DISTINCT ON (email)
        email, name, jira_account_id
      FROM (
        SELECT lower(assignee_email) AS email, assignee_name AS name, assignee_account_id AS jira_account_id
        FROM jira_issues
        WHERE assignee_email IS NOT NULL AND assignee_name IS NOT NULL ${assigneeFilter}
        UNION ALL
        SELECT lower(reporter_email) AS email, reporter_name AS name, reporter_account_id AS jira_account_id
        FROM jira_issues
        WHERE reporter_email IS NOT NULL AND reporter_name IS NOT NULL ${reporterFilter}
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
    ),
    -- Already-filtered AND limited — the jira_account_id enrichment below
    -- only has to run over this small row set, not the full candidate set.
    limited AS (
      SELECT email, name, jira_account_id
      FROM combined_people
      ORDER BY name ASC
      LIMIT ${limit}
    )
    SELECT email, name, jira_account_id FROM limited WHERE jira_account_id IS NOT NULL
    UNION ALL
    SELECT l.email, l.name, jira_ids.jira_account_id
    FROM limited l
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        (SELECT ji.assignee_account_id FROM jira_issues ji
         WHERE lower(ji.assignee_email) = l.email AND ji.assignee_account_id IS NOT NULL
         LIMIT 1),
        (SELECT ji.reporter_account_id FROM jira_issues ji
         WHERE lower(ji.reporter_email) = l.email AND ji.reporter_account_id IS NOT NULL
         LIMIT 1)
      ) AS jira_account_id
    ) jira_ids ON true
    WHERE l.jira_account_id IS NULL
    ORDER BY name ASC
  `);

  return result.rows as { email: string; name: string; jira_account_id: string | null }[];
}
