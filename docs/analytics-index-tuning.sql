-- Index tuning for the two slow analytics endpoints:
--   GET /api/analytics/overview
--   GET /api/analytics/workload/boards
--
-- RUN THESE BY HAND, NOT AS A DRIZZLE MIGRATION.
--
-- scripts/build.sh runs `pnpm run db:migrate` on every production deploy. A
-- plain CREATE INDEX takes a lock that blocks writes on jira_issues for the
-- duration of the build, which would stall the Jira webhooks. CREATE INDEX
-- CONCURRENTLY cannot run inside a transaction, and drizzle-kit wraps
-- migrations in one, so these belong outside the migration pipeline.
--
-- Run each statement separately, off-peak, against the Flux database:
--   psql "$DATABASE_URL" -c "<one statement>"
--
-- CONCURRENTLY can leave an INVALID index behind if it fails. Check with the
-- query at the bottom and DROP + retry any invalid one.
--
-- NOTE: none of this has been validated with EXPLAIN against the real data --
-- the credentials supplied pointed at the `rootuat` promotions database, which
-- has no jira_issues table. Confirm with EXPLAIN (ANALYZE, BUFFERS) before and
-- after, and keep only the indexes that actually get picked up.


-- 1. lower(assignee_email)
--
-- workload/boards filters `WHERE lower(ji.assignee_email) IN (...)`. The
-- existing jira_issues_assignee_email_idx is on the bare column, so wrapping it
-- in lower() makes it unusable and forces a sequential scan of jira_issues.
-- This expression index restores an index scan without touching the query's
-- case-insensitive semantics.
CREATE INDEX CONCURRENTLY IF NOT EXISTS jira_issues_assignee_email_lower_idx
  ON jira_issues (lower(assignee_email));


-- 2. jira_created_at
--
-- The overview "created per week" CTE filters on ji.jira_created_at over a
-- quarter, and the unplanned-issue classification reads it per row. There is
-- currently no index on this column at all (completed_at has one).
CREATE INDEX CONCURRENTLY IF NOT EXISTS jira_issues_jira_created_at_idx
  ON jira_issues (jira_created_at);


-- 3. Open issues, by project
--
-- Both endpoints ask for "every open issue, any age, plus recently completed".
-- The open half is the expensive part and it re-scans the whole table. A
-- partial index over just the not-done rows is small and stays small, since
-- issues leave it as they are completed.
--
-- IMPORTANT: verify the predicate matches your actual status_category values
-- before trusting this --
--   SELECT DISTINCT status_category FROM jira_issues;
-- Postgres will only use a partial index when the query's WHERE clause
-- provably implies the index predicate, so this needs to line up with the SQL
-- in the routes. If the values in use are not exactly these, adjust or skip.
CREATE INDEX CONCURRENTLY IF NOT EXISTS jira_issues_open_project_idx
  ON jira_issues (project_id)
  WHERE NOT (
    lower(status_category) = 'done'
    OR lower(status_category) LIKE '%complete%'
    OR lower(status_category) LIKE '%closed%'
  );


-- Verification -------------------------------------------------------------

-- Any index left INVALID by a failed CONCURRENTLY build:
--   SELECT i.indexrelid::regclass AS index_name
--   FROM pg_index i
--   JOIN pg_class c ON c.oid = i.indexrelid
--   WHERE NOT i.indisvalid AND c.relname LIKE 'jira_issues%';

-- Whether the planner actually uses them (run before and after):
--   EXPLAIN (ANALYZE, BUFFERS) <the route's query>;

-- Index usage counts, after a few hours of real traffic:
--   SELECT relname, indexrelname, idx_scan
--   FROM pg_stat_user_indexes
--   WHERE relname = 'jira_issues'
--   ORDER BY idx_scan DESC;
-- An index sitting at idx_scan = 0 is pure write overhead -- drop it.
