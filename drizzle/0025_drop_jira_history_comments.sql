-- Drop the jira_status_history and jira_comments tables. Their analytical value
-- now lives in the jira_issues rollup columns (completed_at, current_status_since,
-- time_in_status), backfilled in 0024. Per-issue timeline and comments are fetched
-- from Jira at runtime.
--
-- INTENTIONALLY NOT REGISTERED IN drizzle/meta/_journal.json yet. This is the
-- destructive step and must run only AFTER 0024 is applied and the dashboards are
-- verified against the rollup. To apply: add the 0025 entry to _journal.json and
-- run `pnpm db:migrate`.

DROP TABLE IF EXISTS "jira_status_history";--> statement-breakpoint
DROP TABLE IF EXISTS "jira_comments";
