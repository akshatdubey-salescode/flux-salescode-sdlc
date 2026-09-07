import { cacheLife, cacheTag } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { KEKA_DIRECTORY_TAG, KEKA_ATTENDANCE_TAG } from "@/lib/keka/cache-tags";
import { loadKekaDirectory } from "@/lib/keka/directory";
import { isKekaPerson } from "@/lib/keka/people";
import { GITHUB_STATS_TAG } from "@/lib/github/cache-tags";
import { BUG_ISSUE_TYPES, BUG_INVALID_STATUSES } from "@/lib/scorecard/config";

export type PersonProject = {
  projectId: string;
  projectName: string;
  projectKey: string;
  issueCount: number;
  openCount: number;
  completedInWindow: number;
  p1Bugs: number;
  p2Bugs: number;
  p3Bugs: number;
  bugTotal: number;
};

export type PersonProjectsRow = {
  email: string;
  name: string;
  department: string | null;
  jobTitle: string | null;
  managerName: string | null;
  projects: PersonProject[];
  totalIssues: number;
  totalOpen: number;
  totalP1Bugs: number;
  totalP2Bugs: number;
  totalP3Bugs: number;
  totalBugs: number;
  // Net lines of code (additions − deletions) over the period, from GitHub
  // contributor stats (weekly granularity), summed across the person's mapped
  // GitHub logins and tracked repos. Person-level — LOC is attributed to
  // commit authors, not Jira projects. null when the person has no mapped
  // GitHub activity in the period.
  locNet: number | null;
  locAdditions: number | null;
  locDeletions: number | null;
  // Keka attendance over the period. "Present" = days with logged effective
  // hours > 0 (weekly offs/holidays don't count), matching
  // summarizeAttendance() in lib/keka/my-attendance-stats.ts. workingDays =
  // days with dayType 0 (working day) — holidays (1) and weekly-offs (2)
  // excluded. null when the person has no attendance rows in the period
  // (not in Keka, or not synced).
  daysPresent: number | null;
  daysAbsent: number | null;
  workingDays: number | null;
  avgEffectiveHours: number | null;
};

type AttendanceAggRow = {
  email: string;
  days_present: number;
  days_absent: number;
  working_days: number;
  avg_hours: number | null;
};

type PairRow = {
  email: string;
  name: string | null;
  project_id: string;
  project_name: string;
  project_key: string;
  issue_count: number;
  open_count: number;
  completed_in_window: number;
};

type BugRow = {
  email: string;
  name: string | null;
  project_id: string;
  project_name: string;
  project_key: string;
  p1_bugs: number;
  p2_bugs: number;
  p3_bugs: number;
};

type LocRow = {
  email: string;
  net: number;
  additions: number;
  deletions: number;
};

/**
 * One row per person × project for issues "active" in the window: the issue
 * existed by the end of the window and was last touched on/after its start
 * (a Jira update moves jira_updated_at on any change, so dormant backlog
 * items from before the window are excluded). A person is counted on an
 * issue as the primary assignee or as an additional assignee.
 *
 * Bug counts (P1/P2/P3) follow the Bug Board's semantics instead: a bug is
 * attributed to its ISSUE OWNER (the project's issue-owner custom field, not
 * the assignee) and is counted when it was CREATED in the window. Bugs with
 * no owner set aren't attributed to anyone here.
 *
 * Every current (active) Keka employee gets a row even with zero Jira
 * activity in the window — their LOC and attendance still populate, so idle
 * people are visible instead of silently absent.
 */
export async function fetchPeopleProjects(
  start: string,
  end: string
): Promise<PersonProjectsRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues");
  cacheTag("projects");
  cacheTag(KEKA_DIRECTORY_TAG);
  cacheTag(KEKA_ATTENDANCE_TAG);
  cacheTag(GITHUB_STATS_TAG);

  const res = await db.execute(sql`
    WITH windowed AS (
      SELECT
        ji.id,
        ji.project_id,
        ji.assignee_email,
        ji.assignee_name,
        ji.additional_assignee_emails,
        ji.completed_at,
        psm.canonical_status
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id AND jp.is_active = true
      LEFT JOIN project_status_mappings psm
        ON psm.project_id = ji.project_id AND psm.raw_status = ji.status
      WHERE ji.jira_created_at::date <= ${end}::date
        AND COALESCE(ji.jira_updated_at, ji.jira_created_at)::date >= ${start}::date
    ),
    person_issue AS (
      SELECT
        id,
        project_id,
        lower(assignee_email) AS email,
        assignee_name AS name,
        completed_at,
        canonical_status
      FROM windowed
      WHERE assignee_email IS NOT NULL AND trim(assignee_email) != ''
      UNION
      SELECT
        w.id,
        w.project_id,
        lower(ae.email) AS email,
        NULL AS name,
        w.completed_at,
        w.canonical_status
      FROM windowed w, unnest(w.additional_assignee_emails) AS ae(email)
      WHERE trim(ae.email) != ''
    )
    SELECT
      pi.email,
      MAX(pi.name) AS name,
      pi.project_id::text AS project_id,
      jp.name AS project_name,
      jp.jira_project_key AS project_key,
      COUNT(DISTINCT pi.id)::int AS issue_count,
      COUNT(DISTINCT pi.id) FILTER (
        WHERE pi.canonical_status IS DISTINCT FROM 'DONE'
          AND pi.canonical_status IS DISTINCT FROM 'CANCELLED'
      )::int AS open_count,
      COUNT(DISTINCT pi.id) FILTER (
        WHERE pi.completed_at::date >= ${start}::date
          AND pi.completed_at::date <= ${end}::date
      )::int AS completed_in_window
    FROM person_issue pi
    JOIN jira_projects jp ON jp.id = pi.project_id
    GROUP BY pi.email, pi.project_id, jp.name, jp.jira_project_key
    ORDER BY pi.email, issue_count DESC
  `);

  // Bug counts, matching the Bug Board: bug-family issue types
  // (bug/defect/sub-bug), excluding "Not a Bug"-style statuses (compared
  // after the same normalization as normalizeStatus()), CREATED in the
  // window, attributed to the issue owner — the first populated
  // project-specific issue-owner custom field (single-user object or
  // multi-user array). Priorities are stored literally as P1..P4.
  const bugTypes = sql.join(
    [...BUG_ISSUE_TYPES].map((t) => sql`${t}`),
    sql`, `
  );
  const invalidStatuses = sql.join(
    [...BUG_INVALID_STATUSES].map((s) => sql`${s}`),
    sql`, `
  );
  const apostropheClass = "['’`]";

  const bugRes = await db.execute(sql`
    WITH bug_base AS (
      SELECT
        ji.priority,
        ji.project_id,
        jp.name AS project_name,
        jp.jira_project_key AS project_key,
        -- Jira hides emailAddress for users with a private email (only
        -- accountId + displayName are stored) — resolve those through the
        -- app-user and observer-board accountId mappings so their bugs
        -- aren't misfiled as unowned.
        lower(COALESCE(
          ow.v->>'emailAddress', ow.v->0->>'emailAddress',
          uacc.id, obm.email
        )) AS email,
        COALESCE(ow.v->>'displayName', ow.v->0->>'displayName') AS name
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id AND jp.is_active = true
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
      -- LATERAL … LIMIT 1, not a plain join: users.jira_account_id carries no
      -- unique constraint, so a duplicate mapping (an email change leaving two
      -- user rows, a bad identity backfill) would fan out this bug row and
      -- double its contribution to every count below.
      LEFT JOIN LATERAL (
        SELECT u.id FROM users u
        WHERE u.jira_account_id = COALESCE(ow.v->>'accountId', ow.v->0->>'accountId')
        LIMIT 1
      ) uacc ON true
      LEFT JOIN LATERAL (
        SELECT b.email FROM observer_board_members b
        WHERE b.jira_account_id = COALESCE(ow.v->>'accountId', ow.v->0->>'accountId')
        LIMIT 1
      ) obm ON true
      WHERE lower(trim(ji.issue_type)) IN (${bugTypes})
        AND btrim(lower(regexp_replace(
              regexp_replace(ji.status, ${apostropheClass}, '', 'g'),
              '[[:space:]]+', ' ', 'g'
            ))) NOT IN (${invalidStatuses})
        AND ji.jira_created_at::date >= ${start}::date
        AND ji.jira_created_at::date <= ${end}::date
    )
    SELECT
      email,
      MAX(name) AS name,
      project_id::text AS project_id,
      MAX(project_name) AS project_name,
      MAX(project_key) AS project_key,
      COUNT(*) FILTER (WHERE priority = 'P1')::int AS p1_bugs,
      COUNT(*) FILTER (WHERE priority = 'P2')::int AS p2_bugs,
      COUNT(*) FILTER (WHERE priority = 'P3')::int AS p3_bugs
    FROM bug_base
    WHERE email IS NOT NULL AND trim(email) != ''
    GROUP BY email, project_id
  `);

  // Per-person net LOC over the window, mirroring the Lines of Code view:
  // weekly GitHub contributor stats filtered by week-start date, mapped to app
  // users via their GitHub accounts, bots excluded.
  const locRes = await db.execute(sql`
    SELECT
      lower(u.id) AS email,
      SUM(gcs.additions - gcs.deletions)::int AS net,
      SUM(gcs.additions)::int AS additions,
      SUM(gcs.deletions)::int AS deletions
    FROM github_contributor_stats gcs
    JOIN github_repos gr ON gr.id = gcs.repo_id AND gr.is_tracked = true
    JOIN github_accounts ga ON ga.github_login = gcs.github_login
    JOIN users u ON u.id = ga.user_id
    WHERE ga.is_bot = false
      AND gcs.week_start::date >= ${start}::date
      AND gcs.week_start::date <= ${end}::date
    GROUP BY lower(u.id)
  `);
  const locByEmail = new Map(
    (locRes.rows as LocRow[]).map((r) => [r.email, r])
  );

  // Per-person attendance over the window. "Present" = days with logged
  // effective hours > 0, "absent" = the sync's day-type-aware is_absent flag —
  // the same semantics as summarizeAttendance(). Attendance rows link to the
  // directory by Keka employee GUID, falling back to the employee number for
  // rows synced before the GUID was resolved.
  const attRes = await db.execute(sql`
    SELECT
      lower(ke.email) AS email,
      COUNT(*) FILTER (WHERE ka.total_effective_hours > 0)::int AS days_present,
      COUNT(*) FILTER (WHERE ka.is_absent)::int AS days_absent,
      COUNT(*) FILTER (WHERE ka.day_type = '0')::int AS working_days,
      ROUND(AVG(ka.total_effective_hours)
        FILTER (WHERE ka.total_effective_hours > 0)::numeric, 1)::float AS avg_hours
    FROM keka_attendance ka
    JOIN keka_employees ke
      ON (ka.keka_employee_id IS NOT NULL AND ka.keka_employee_id = ke.keka_employee_id)
      OR (ka.keka_employee_id IS NULL AND ke.employee_number = ka.employee_number)
    WHERE ke.email IS NOT NULL
      AND ka.attendance_date >= ${start}::date
      AND ka.attendance_date <= ${end}::date
    GROUP BY lower(ke.email)
  `);
  const attByEmail = new Map(
    (attRes.rows as AttendanceAggRow[]).map((r) => [r.email, r])
  );

  const pairs = res.rows as PairRow[];
  const bugPairs = bugRes.rows as BugRow[];
  const dir = await loadKekaDirectory();

  const byEmail = new Map<string, PersonProjectsRow>();

  /**
   * Row for an email, created on first sight — or null when the email isn't a
   * current Keka employee. That null is the Keka-only rule
   * (src/lib/keka/people.ts) applied at the one place rows come into
   * existence, so it covers both the assignee pairs and the bug-owner pairs
   * without either loop having to remember: an ex-employee's issues and an
   * external bug owner never open a row, so they never reach the board or its
   * totals.
   */
  function getOrCreateRow(email: string, fallbackName: string | null): PersonProjectsRow | null {
    let row = byEmail.get(email);
    if (row) return row;
    const e = dir.get(email);
    if (!e) return null;
    const loc = locByEmail.get(email);
    const att = attByEmail.get(email);
    row = {
      email,
      name: e?.displayName ?? fallbackName ?? email.split("@")[0],
      department: e?.department ?? null,
      jobTitle: e?.jobTitle ?? null,
      managerName: e?.managerName ?? null,
      projects: [],
      totalIssues: 0,
      totalOpen: 0,
      totalP1Bugs: 0,
      totalP2Bugs: 0,
      totalP3Bugs: 0,
      totalBugs: 0,
      locNet: loc?.net ?? null,
      locAdditions: loc?.additions ?? null,
      locDeletions: loc?.deletions ?? null,
      daysPresent: att?.days_present ?? null,
      daysAbsent: att?.days_absent ?? null,
      workingDays: att?.working_days ?? null,
      avgEffectiveHours: att?.avg_hours ?? null,
    };
    byEmail.set(email, row);
    return row;
  }

  for (const pair of pairs) {
    const row = getOrCreateRow(pair.email, pair.name);
    if (!row) continue;
    // Primary-assignee rows carry a name; keep the first non-null one when
    // Keka has the person but no display name for them.
    if (!dir.get(pair.email)?.displayName && pair.name && row.name === pair.email.split("@")[0]) {
      row.name = pair.name;
    }
    row.projects.push({
      projectId: pair.project_id,
      projectName: pair.project_name,
      projectKey: pair.project_key,
      issueCount: pair.issue_count,
      openCount: pair.open_count,
      completedInWindow: pair.completed_in_window,
      p1Bugs: 0,
      p2Bugs: 0,
      p3Bugs: 0,
      bugTotal: 0,
    });
    row.totalIssues += pair.issue_count;
    row.totalOpen += pair.open_count;
  }

  // Overlay bug counts. An owner can have bugs in a project where they have
  // no assigned issues in the window — that project still appears on their
  // row, with zero issue/task counts.
  for (const bug of bugPairs) {
    const row = getOrCreateRow(bug.email, bug.name);
    if (!row) continue;
    const bugTotal = bug.p1_bugs + bug.p2_bugs + bug.p3_bugs;
    let project = row.projects.find((p) => p.projectId === bug.project_id);
    if (!project) {
      project = {
        projectId: bug.project_id,
        projectName: bug.project_name,
        projectKey: bug.project_key,
        issueCount: 0,
        openCount: 0,
        completedInWindow: 0,
        p1Bugs: 0,
        p2Bugs: 0,
        p3Bugs: 0,
        bugTotal: 0,
      };
      row.projects.push(project);
    }
    project.p1Bugs = bug.p1_bugs;
    project.p2Bugs = bug.p2_bugs;
    project.p3Bugs = bug.p3_bugs;
    project.bugTotal = bugTotal;
    row.totalP1Bugs += bug.p1_bugs;
    row.totalP2Bugs += bug.p2_bugs;
    row.totalP3Bugs += bug.p3_bugs;
    row.totalBugs += bugTotal;
  }

  // The Keka directory holds only active employees, so this adds exactly
  // the "no work this period" set (zero projects, LOC/attendance still
  // filled from their own maps).
  for (const entry of dir.all()) {
    if (entry.email) getOrCreateRow(entry.email.toLowerCase(), entry.displayName);
  }

  return [...byEmail.values()].sort(
    (a, b) =>
      b.projects.length - a.projects.length ||
      b.totalIssues - a.totalIssues ||
      a.name.localeCompare(b.name)
  );
}

export type PersonRepoContribution = {
  email: string;
  repoFullName: string;
  commits: number;
  additions: number;
  deletions: number;
  net: number;
};

/**
 * Per-person, per-repo contribution detail over the window — the breakdown
 * behind the person-level LOC number (same source, filters, and mapping).
 * Used by the Excel export's Repos sheet.
 */
export async function fetchPersonRepoContributions(
  start: string,
  end: string
): Promise<PersonRepoContribution[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(GITHUB_STATS_TAG);

  const res = await db.execute(sql`
    SELECT
      lower(u.id) AS email,
      gr.full_name AS "repoFullName",
      SUM(gcs.commits)::int AS commits,
      SUM(gcs.additions)::int AS additions,
      SUM(gcs.deletions)::int AS deletions,
      SUM(gcs.additions - gcs.deletions)::int AS net
    FROM github_contributor_stats gcs
    JOIN github_repos gr ON gr.id = gcs.repo_id AND gr.is_tracked = true
    JOIN github_accounts ga ON ga.github_login = gcs.github_login
    JOIN users u ON u.id = ga.user_id
    WHERE ga.is_bot = false
      AND gcs.week_start::date >= ${start}::date
      AND gcs.week_start::date <= ${end}::date
    GROUP BY lower(u.id), gr.full_name
    ORDER BY lower(u.id), net DESC
  `);
  return res.rows as PersonRepoContribution[];
}

export type OwnedBug = {
  email: string;
  ownerName: string | null;
  jiraKey: string;
  summary: string;
  priority: string | null;
  status: string;
  projectName: string;
  projectKey: string;
  browseUrl: string;
  createdAt: string;
};

/**
 * Every owner-attributed bug created in the window — the issue-level detail
 * behind the P1/P2/P3 counts (same bug-family/invalid-status/owner rules;
 * includes every priority, not just P1–P3). Used by the Excel export's Bugs
 * sheet. Capped at 20000 rows.
 */
export async function fetchOwnedBugs(
  start: string,
  end: string
): Promise<OwnedBug[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues");
  cacheTag("projects");
  cacheTag(KEKA_DIRECTORY_TAG);

  const bugTypes = sql.join(
    [...BUG_ISSUE_TYPES].map((t) => sql`${t}`),
    sql`, `
  );
  const invalidStatuses = sql.join(
    [...BUG_INVALID_STATUSES].map((s) => sql`${s}`),
    sql`, `
  );
  const apostropheClass = "['’`]";

  const res = await db.execute(sql`
    WITH bug_base AS (
      SELECT
        -- Same accountId fallback as the count query: Jira hides
        -- emailAddress for private-email users.
        lower(COALESCE(
          ow.v->>'emailAddress', ow.v->0->>'emailAddress',
          uacc.id, obm.email
        )) AS email,
        COALESCE(ow.v->>'displayName', ow.v->0->>'displayName') AS "ownerName",
        ji.jira_key AS "jiraKey",
        ji.summary,
        ji.priority,
        ji.status,
        jp.name AS "projectName",
        jp.jira_project_key AS "projectKey",
        rtrim(jp.jira_base_url, '/') || '/browse/' || ji.jira_key AS "browseUrl",
        ji.jira_created_at AS "createdAt"
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id AND jp.is_active = true
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
      -- LATERAL … LIMIT 1, not a plain join: users.jira_account_id carries no
      -- unique constraint, so a duplicate mapping (an email change leaving two
      -- user rows, a bad identity backfill) would fan out this bug row and
      -- double its contribution to every count below.
      LEFT JOIN LATERAL (
        SELECT u.id FROM users u
        WHERE u.jira_account_id = COALESCE(ow.v->>'accountId', ow.v->0->>'accountId')
        LIMIT 1
      ) uacc ON true
      LEFT JOIN LATERAL (
        SELECT b.email FROM observer_board_members b
        WHERE b.jira_account_id = COALESCE(ow.v->>'accountId', ow.v->0->>'accountId')
        LIMIT 1
      ) obm ON true
      WHERE lower(trim(ji.issue_type)) IN (${bugTypes})
        AND btrim(lower(regexp_replace(
              regexp_replace(ji.status, ${apostropheClass}, '', 'g'),
              '[[:space:]]+', ' ', 'g'
            ))) NOT IN (${invalidStatuses})
        AND ji.jira_created_at::date >= ${start}::date
        AND ji.jira_created_at::date <= ${end}::date
    )
    SELECT *
    FROM bug_base
    WHERE email IS NOT NULL AND trim(email) != ''
      -- Keka-only rule (src/lib/keka/people.ts), matching how
      -- fetchPeopleProjects drops non-Keka owners at row creation — so this
      -- sheet's per-owner bug totals reconcile with the board's.
      --
      -- The bug is NOT lost: fetchUnattributedBugs picks up anything this
      -- rejects, because it asks for bugs with no *live* owner rather than no
      -- owner field. Between them the two functions still partition every bug
      -- in the window, exactly as they did before this gate existed — check
      -- both if you ever change either predicate.
      AND ${isKekaPerson(sql`lower(email)`)}
    ORDER BY "createdAt" DESC
    LIMIT 20000
  `);
  return res.rows as OwnedBug[];
}

export type UnattributedBug = {
  jiraKey: string;
  summary: string;
  priority: string | null;
  status: string;
  projectName: string;
  projectKey: string;
  browseUrl: string;
  createdAt: string;
  assigneeName: string | null;
  assigneeEmail: string | null;
  // Set only for the "owner has left" case: who the Issue Owner field still
  // names, even though they're no longer a current employee. null when the
  // field was simply never filled in. Both cases need an owner assigning; this
  // says which kind of gap it is and who to ask.
  formerOwnerName: string | null;
  formerOwnerEmail: string | null;
};

/**
 * Bugs created in the window that nobody currently owns — invisible in the
 * per-person counts above. Two kinds of gap, both actionable and both needing
 * the same fix (set a live Issue Owner):
 *
 *   1. The Issue Owner field was never filled in.
 *   2. It names someone who no longer works here, so the Keka-only rule
 *      (src/lib/keka/people.ts) means they can't be shown as its owner.
 *      `formerOwner*` carries who it was — the bug still has to be tracked and
 *      reassigned, and knowing whose queue it fell out of is the fastest route
 *      to that.
 *
 * Case 2 is why this is "no live owner" and not "no owner field": it's the
 * other half of fetchOwnedBugs' Keka gate, and together the two functions
 * cover every bug in the window with no double-counting. A departed owner's
 * bugs are exactly the ones that would otherwise rot unnoticed, so they must
 * land somewhere.
 *
 * Surfaced with the assignee for context. Capped at 20000 rows.
 */
export async function fetchUnattributedBugs(
  start: string,
  end: string
): Promise<UnattributedBug[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("jira-issues");
  cacheTag("projects");
  cacheTag(KEKA_DIRECTORY_TAG);

  const bugTypes = sql.join(
    [...BUG_ISSUE_TYPES].map((t) => sql`${t}`),
    sql`, `
  );
  const invalidStatuses = sql.join(
    [...BUG_INVALID_STATUSES].map((s) => sql`${s}`),
    sql`, `
  );
  const apostropheClass = "['’`]";

  const res = await db.execute(sql`
    WITH bug_base AS (
      SELECT
        -- Same accountId fallback as the count query — the owner field alone
        -- isn't enough, since Atlassian privacy settings strip emailAddress
        -- from the payload for some users.
        lower(COALESCE(
          ow.v->>'emailAddress', ow.v->0->>'emailAddress',
          uacc.id, obm.email
        )) AS email,
        COALESCE(ow.v->>'displayName', ow.v->0->>'displayName') AS owner_name,
        ji.jira_key AS "jiraKey",
        ji.summary,
        ji.priority,
        ji.status,
        jp.name AS "projectName",
        jp.jira_project_key AS "projectKey",
        rtrim(jp.jira_base_url, '/') || '/browse/' || ji.jira_key AS "browseUrl",
        ji.jira_created_at AS "createdAt",
        ji.assignee_name AS "assigneeName",
        ji.assignee_email AS "assigneeEmail"
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id AND jp.is_active = true
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
      -- LATERAL … LIMIT 1, not a plain join: users.jira_account_id carries no
      -- unique constraint, so a duplicate mapping (an email change leaving two
      -- user rows, a bad identity backfill) would fan out this bug row and
      -- double its contribution to every count below.
      LEFT JOIN LATERAL (
        SELECT u.id FROM users u
        WHERE u.jira_account_id = COALESCE(ow.v->>'accountId', ow.v->0->>'accountId')
        LIMIT 1
      ) uacc ON true
      LEFT JOIN LATERAL (
        SELECT b.email FROM observer_board_members b
        WHERE b.jira_account_id = COALESCE(ow.v->>'accountId', ow.v->0->>'accountId')
        LIMIT 1
      ) obm ON true
      WHERE lower(trim(ji.issue_type)) IN (${bugTypes})
        AND btrim(lower(regexp_replace(
              regexp_replace(ji.status, ${apostropheClass}, '', 'g'),
              '[[:space:]]+', ' ', 'g'
            ))) NOT IN (${invalidStatuses})
        AND ji.jira_created_at::date >= ${start}::date
        AND ji.jira_created_at::date <= ${end}::date
    )
    -- "No live owner" — the two gaps described above. The second disjunct is
    -- the other half of fetchOwnedBugs' Keka gate: without it, a bug owned by
    -- someone who has left would appear on neither sheet and quietly stop
    -- being tracked. formerOwner* is populated only for that case, so the two
    -- kinds of gap stay distinguishable in the export.
    SELECT
      "jiraKey", summary, priority, status, "projectName", "projectKey",
      "browseUrl", "createdAt", "assigneeName", "assigneeEmail",
      CASE WHEN email IS NOT NULL AND trim(email) <> ''
           THEN owner_name END AS "formerOwnerName",
      CASE WHEN email IS NOT NULL AND trim(email) <> ''
           THEN email END AS "formerOwnerEmail"
    FROM bug_base
    WHERE email IS NULL
       OR trim(email) = ''
       OR NOT ${isKekaPerson(sql`lower(email)`)}
    ORDER BY "createdAt" DESC
    LIMIT 20000
  `);
  return res.rows as UnattributedBug[];
}
