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

  // Sole source: the synced Keka employee directory (keka_employees only ever
  // holds active/current staff — see src/lib/keka/directory.ts). This endpoint
  // backs every people picker in the product (delay-reason owners, my-tasks
  // assignee, delivery responsible-people, sprint email recipients, Team Pulse
  // "add member"), so it is the chokepoint that enforces the Keka-only rule in
  // src/lib/keka/people.ts: if someone can't be picked here, they can't be
  // attached to anything.
  //
  // There used to be a `jira_only` fallback CTE that also offered anyone found
  // via jira_issues.assignee_email / reporter_email with no Keka record at all
  // (the intent was contractors/vendors without an HR record). In practice it
  // is what let ex-employees, client reporters and Atlassian service accounts
  // back into every picker, so it is gone: no Keka row, not pickable.
  //
  // Jira is still consulted for exactly one thing — opportunistically
  // resolving a jira_account_id for a Keka employee, which callers like Team
  // Pulse's "add member" flow need.
  //
  // Performance: the name/email filter must be applied INSIDE the source
  // query, not after — and the jira_account_id LATERAL lookup must run only on
  // the final LIMITed rows, not on every Keka employee. Measured via EXPLAIN
  // ANALYZE against the live dataset (233 Keka employees, ~56k jira_issues):
  // filtering late, plus resolving jira_account_id via a per-employee LATERAL
  // over all 233 rows, cost ~4.2s per search — the LATERAL's
  // lower(assignee_email)/lower(reporter_email) predicates couldn't use the
  // plain btree indexes on those columns (stored mixed-case, see sync.ts),
  // forcing a full sequential scan of jira_issues once per employee. Pushing
  // the filter down + limiting before the LATERAL, plus the expression indexes
  // in schema.ts (jira_issues_assignee_email_lower_idx /
  // _reporter_email_lower_idx) so the LATERAL is an index scan when it does
  // run, brought this down to ~100ms.
  const kekaFilter = q
    ? sql`AND (COALESCE(NULLIF(ke.display_name, ''), ke.email) ILIKE ${"%" + q + "%"} OR ke.email ILIKE ${"%" + q + "%"})`
    : sql``;

  const result = await db.execute(sql`
    -- DISTINCT ON guards against a duplicate work email across two Keka rows
    -- (a rehire, or a data-entry twin); the picker must offer one row per person.
    WITH keka_people AS (
      SELECT DISTINCT ON (ke.email)
        ke.email AS email,
        COALESCE(NULLIF(ke.display_name, ''), ke.email) AS name
      FROM keka_employees ke
      WHERE ke.email IS NOT NULL ${kekaFilter}
      ORDER BY ke.email
    ),
    -- Already-filtered AND limited — the jira_account_id enrichment below only
    -- has to run over this small row set, not the whole directory.
    limited AS (
      SELECT email, name
      FROM keka_people
      ORDER BY name ASC
      LIMIT ${limit}
    )
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
    ORDER BY l.name ASC
  `);

  return result.rows as { email: string; name: string; jira_account_id: string | null }[];
}
