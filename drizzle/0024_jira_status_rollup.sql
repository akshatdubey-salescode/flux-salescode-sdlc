-- Add per-issue status-history rollup columns to jira_issues, then backfill
-- them from the existing jira_status_history table. After this runs and is
-- verified, jira_status_history and jira_comments are dropped in a later
-- migration.

ALTER TABLE "jira_issues" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jira_issues" ADD COLUMN "current_status_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jira_issues" ADD COLUMN "time_in_status" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jira_issues_completed_at_idx" ON "jira_issues" USING btree ("completed_at");--> statement-breakpoint

-- Backfill current_status_since: the timestamp of the most recent transition,
-- i.e. when the issue entered its current status.
UPDATE "jira_issues" ji SET "current_status_since" = sub.cs
FROM (
  SELECT issue_id, MAX(changed_at) AS cs
  FROM "jira_status_history"
  GROUP BY issue_id
) sub
WHERE sub.issue_id = ji.id;--> statement-breakpoint

-- Issues with no recorded transitions: fall back to creation time.
UPDATE "jira_issues"
SET "current_status_since" = "jira_created_at"
WHERE "current_status_since" IS NULL;--> statement-breakpoint

-- Backfill time_in_status: finalized seconds per status. duration_seconds is
-- the time spent in each row's to_status; the open current segment has a NULL
-- duration and is intentionally excluded.
UPDATE "jira_issues" ji SET "time_in_status" = sub.tis
FROM (
  SELECT issue_id, jsonb_object_agg(to_status, secs) AS tis
  FROM (
    SELECT issue_id, to_status, SUM(duration_seconds) AS secs
    FROM "jira_status_history"
    WHERE duration_seconds IS NOT NULL
    GROUP BY issue_id, to_status
  ) per_status
  GROUP BY issue_id
) sub
WHERE sub.issue_id = ji.id;--> statement-breakpoint

-- Backfill completed_at: most recent transition from a non-DONE canonical
-- status into a DONE canonical status.
UPDATE "jira_issues" ji SET "completed_at" = sub.completed_at
FROM (
  SELECT jsh.issue_id, MAX(jsh.changed_at) AS completed_at
  FROM "jira_status_history" jsh
  JOIN "jira_issues" ji2 ON ji2.id = jsh.issue_id
  JOIN "project_status_mappings" psm_to
    ON psm_to.project_id = ji2.project_id
    AND psm_to.raw_status = jsh.to_status
    AND psm_to.canonical_status = 'DONE'
  LEFT JOIN "project_status_mappings" psm_from
    ON psm_from.project_id = ji2.project_id
    AND psm_from.raw_status = jsh.from_status
  WHERE jsh.from_status IS NULL
    OR psm_from.canonical_status IS DISTINCT FROM 'DONE'
  GROUP BY jsh.issue_id
) sub
WHERE sub.issue_id = ji.id;
