import { type NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/server";
import { FRESHDESK_CUSTOM_FIELD } from "@/lib/freshdesk/sync";
import { BUG_ISSUE_TYPES, BUG_INVALID_STATUSES } from "@/lib/scorecard/config";
import { currentFiscalQuarterChip } from "@/lib/date-utils";
import { normalizeEnvironment, priorityBucket, isDoneOrCancelled, MISSING_ISSUE_OWNER, type BugRow } from "@/lib/bug-summary";

// Org-wide flat bug list for the Bug Board's "Export to Excel" button.
// Deliberately its OWN query, not the shared loadBugRows() every other
// BugTracker scope uses — this mirrors fetchBugBoard's exact owner (Issue
// Owner field ONLY, never the assignee) + environment + customer-found
// resolution (/api/bugs/route.ts) so the exported rows are counted exactly
// the way the on-screen table counts them. loadBugRows has neither the
// customer-found flag nor this same owner rule, so it can't be reused here.
//
// All the board's filters (Priority chips, Env, Projects, Developers,
// Customer-found only) are applied here too, server-side, against this same
// resolved shape — so "download while filtered" genuinely exports only what
// the filters left on screen, not everything in the date range.

type ExportBugRow = BugRow & { projectId: string; isCustomerFound: boolean };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function csvParam(searchParams: URLSearchParams, key: string): string[] {
  return (searchParams.get(key) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = request.nextUrl;
    const q = currentFiscalQuarterChip();
    const rawStart = searchParams.get("start");
    const rawEnd = searchParams.get("end");
    const start = rawStart && ISO_DATE.test(rawStart) ? rawStart : q?.start;
    const end = rawEnd && ISO_DATE.test(rawEnd) ? rawEnd : q?.end;
    if (!start || !end) {
      return NextResponse.json({ error: "start/end is required" }, { status: 400 });
    }

    const priorities = new Set(csvParam(searchParams, "priorities").map((p) => p.toUpperCase()));
    const env = searchParams.get("env");
    const projectIds = csvParam(searchParams, "projectIds");
    const ownerKeys = csvParam(searchParams, "ownerKeys");
    const cfOnly = searchParams.get("cfOnly") === "true";

    const rows = await fetchAllBugs(start, end);

    const filtered = rows.filter((b) => {
      if (priorities.size > 0 && !priorities.has((b.priority ?? "").toUpperCase())) return false;
      if (env && b.environment !== env) return false;
      if (projectIds.length > 0 && !projectIds.includes(b.projectId)) return false;
      if (ownerKeys.length > 0 && (!b.ownerEmail || !ownerKeys.includes(b.ownerEmail))) return false;
      if (cfOnly && !b.isCustomerFound) return false;
      return true;
    });

    // Strip the internal-only fields (projectId, isCustomerFound — used only
    // for the filtering above) before handing rows to the client and, from
    // there, straight into /api/bugs/export's BugRow[] body.
    const bugs: BugRow[] = filtered.map((b): BugRow => ({
      id: b.id,
      jiraKey: b.jiraKey,
      summary: b.summary,
      projectKey: b.projectKey,
      projectName: b.projectName,
      jiraBaseUrl: b.jiraBaseUrl,
      status: b.status,
      statusCategory: b.statusCategory,
      priority: b.priority,
      priorityBucket: b.priorityBucket,
      environment: b.environment,
      ownerName: b.ownerName,
      ownerEmail: b.ownerEmail,
      assigneeName: b.assigneeName,
      assigneeEmail: b.assigneeEmail,
      isOpen: b.isOpen,
      isInvalid: b.isInvalid,
      jiraCreatedAt: b.jiraCreatedAt,
      jiraUpdatedAt: b.jiraUpdatedAt,
    }));
    return NextResponse.json({ bugs });
  } catch (err) {
    console.error("[bugs/list] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function fetchAllBugs(start: string, end: string): Promise<ExportBugRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("projects", "bugs");

  const fdField = sql.raw(`'${FRESHDESK_CUSTOM_FIELD}'`);
  const bugTypes = sql.join([...BUG_ISSUE_TYPES].map((t) => sql`${t}`), sql`, `);
  const invalidStatuses = sql.join([...BUG_INVALID_STATUSES].map((s) => sql`${s}`), sql`, `);
  const apostropheClass = "['’`]";

  const res = await db.execute(sql`
    WITH base AS (
      SELECT
        ji.id, ji.jira_key, ji.summary, ji.status, ji.status_category, ji.priority,
        ji.assignee_email, ji.assignee_name, ji.jira_created_at, ji.jira_updated_at,
        jp.id            AS project_id,
        jp.name          AS project_name,
        jp.jira_base_url AS jira_base_url,
        jp.jira_project_key AS jira_project_key,
        (
          ji.custom_fields ? ${fdField}
          AND COALESCE(ji.custom_fields->>${fdField}, '') <> ''
        ) AS is_customer,
        ow.v AS owner_val,
        COALESCE(env.env_raw, NULLIF(ji.custom_fields->>'environment', '')) AS env_raw,
        psm.canonical_status AS canonical_status
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id
      LEFT JOIN project_status_mappings psm
        ON psm.project_id = jp.id AND psm.raw_status = ji.status
      LEFT JOIN LATERAL (
        SELECT ji.custom_fields->f.fid AS v
        FROM unnest(COALESCE(jp.issue_owner_field_ids, '{}'::text[]))
             WITH ORDINALITY AS f(fid, ord)
        WHERE ji.custom_fields ? f.fid
          AND (
            (jsonb_typeof(ji.custom_fields->f.fid) = 'object'
              AND (ji.custom_fields->f.fid) ? 'accountId')
            OR (jsonb_typeof(ji.custom_fields->f.fid) = 'array'
              AND jsonb_array_length(ji.custom_fields->f.fid) > 0)
          )
        ORDER BY f.ord LIMIT 1
      ) ow ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(
                 NULLIF(ji.custom_fields->ef.fid->>'value', ''),
                 NULLIF(ji.custom_fields->>ef.fid, '')
               ) AS env_raw
        FROM unnest(COALESCE(jp.environment_field_ids, '{}'::text[]))
             WITH ORDINALITY AS ef(fid, ord)
        WHERE COALESCE(
                NULLIF(ji.custom_fields->ef.fid->>'value', ''),
                NULLIF(ji.custom_fields->>ef.fid, '')
              ) IS NOT NULL
        ORDER BY ef.ord LIMIT 1
      ) env ON true
      WHERE lower(trim(ji.issue_type)) IN (${bugTypes})
        AND btrim(lower(regexp_replace(
              regexp_replace(ji.status, ${apostropheClass}, '', 'g'),
              '\s+', ' ', 'g'
            ))) NOT IN (${invalidStatuses})
        AND ji.jira_created_at >= ${start}::date
        AND ji.jira_created_at < (${end}::date + interval '1 day')
    )
    SELECT
      id, jira_key, summary, status, status_category, priority,
      assignee_email, assignee_name, jira_created_at, jira_updated_at,
      project_id, project_name, jira_base_url, jira_project_key, is_customer, env_raw, canonical_status,
      COALESCE(owner_val->>'emailAddress', owner_val->0->>'emailAddress') AS owner_email,
      COALESCE(owner_val->>'displayName',  owner_val->0->>'displayName')  AS owner_name
    FROM base
  `);

  return (res.rows as Record<string, unknown>[]).map((r): ExportBugRow => {
    const ownerEmail = (r.owner_email as string | null) ?? null;
    const ownerName = (r.owner_name as string | null) ?? MISSING_ISSUE_OWNER;
    const priority = r.priority as string | null;
    // db.execute() (raw SQL) doesn't hydrate timestamp columns into Date
    // instances the way Drizzle's query builder does — pg's driver hands
    // back a string here, not a Date, so new Date(...) rather than
    // assuming .toISOString() already exists on it.
    const jiraCreatedAt = r.jira_created_at as string | Date | null;
    const jiraUpdatedAt = r.jira_updated_at as string | Date | null;
    return {
      id: r.id as string,
      jiraKey: r.jira_key as string,
      summary: r.summary as string,
      projectId: r.project_id as string,
      projectKey: r.jira_project_key as string,
      projectName: r.project_name as string,
      jiraBaseUrl: (r.jira_base_url as string | null) ?? null,
      status: r.status as string,
      statusCategory: (r.status_category as string | null) ?? null,
      priority,
      priorityBucket: priorityBucket(priority),
      environment: normalizeEnvironment(r.env_raw as string | null),
      ownerName,
      ownerEmail,
      assigneeName: (r.assignee_name as string | null)?.trim() || null,
      assigneeEmail: (r.assignee_email as string | null)?.trim().toLowerCase() || null,
      isOpen: !isDoneOrCancelled(r.canonical_status as string | null, r.status_category as string | null),
      isInvalid: false, // excluded at the SQL level above, same as fetchBugBoard
      jiraCreatedAt: jiraCreatedAt ? new Date(jiraCreatedAt).toISOString() : null,
      jiraUpdatedAt: jiraUpdatedAt ? new Date(jiraUpdatedAt).toISOString() : null,
      isCustomerFound: r.is_customer === true,
    };
  });
}
