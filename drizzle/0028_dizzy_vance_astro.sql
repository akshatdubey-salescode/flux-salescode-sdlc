-- ---------------------------------------------------------------------------
-- Snapshot-format normalization migration.
--
-- The drizzle/meta snapshot chain pre-dating this migration was corrupted
-- (missing snapshots 0023-0026, duplicate 0021/0022). It was rebuilt via
-- `drizzle-kit introspect` against the live DB. The fresh snapshot stores
-- indexes in the newer `USING btree (...)` form, so drizzle-kit's first diff
-- against schema.ts produced this migration — every index dropped and
-- recreated with the same definition.
--
-- DDL is transactional in postgres, so the drop/create runs atomically.
-- Definitions are byte-identical to the pre-existing indexes, so this is a
-- no-op in shape but does rebuild every index. Large indexes (e.g. the GIN
-- index on jira_issues.additional_assignee_emails) will take measurable
-- time to rebuild — schedule the deploy accordingly.
-- ---------------------------------------------------------------------------

DROP INDEX "feature_requests_created_at_idx";--> statement-breakpoint
DROP INDEX "feature_requests_priority_idx";--> statement-breakpoint
DROP INDEX "feature_requests_submitted_by_idx";--> statement-breakpoint
DROP INDEX "jira_issues_additional_assignees_gin_idx";--> statement-breakpoint
DROP INDEX "jira_issues_assignee_email_idx";--> statement-breakpoint
DROP INDEX "jira_issues_completed_at_idx";--> statement-breakpoint
DROP INDEX "jira_issues_jira_key_idx";--> statement-breakpoint
DROP INDEX "jira_issues_project_jira_id_idx";--> statement-breakpoint
DROP INDEX "jira_issues_project_updated_idx";--> statement-breakpoint
DROP INDEX "jira_issues_reporter_email_idx";--> statement-breakpoint
DROP INDEX "jira_issues_status_idx";--> statement-breakpoint
DROP INDEX "jira_projects_base_url_key_idx";--> statement-breakpoint
DROP INDEX "jira_sync_jobs_project_idx";--> statement-breakpoint
DROP INDEX "jira_sync_jobs_status_idx";--> statement-breakpoint
DROP INDEX "observer_board_members_board_email_idx";--> statement-breakpoint
DROP INDEX "observer_board_members_board_idx";--> statement-breakpoint
DROP INDEX "project_stakeholders_project_email_idx";--> statement-breakpoint
DROP INDEX "project_stakeholders_project_idx";--> statement-breakpoint
DROP INDEX "project_status_mappings_project_idx";--> statement-breakpoint
DROP INDEX "project_status_mappings_project_raw_idx";--> statement-breakpoint
DROP INDEX "requirements_created_by_idx";--> statement-breakpoint
DROP INDEX "requirements_project_idx";--> statement-breakpoint
DROP INDEX "requirements_repo_idx";--> statement-breakpoint
DROP INDEX "requirements_status_idx";--> statement-breakpoint
DROP INDEX "sla_violations_active_idx";--> statement-breakpoint
DROP INDEX "sla_violations_issue_idx";--> statement-breakpoint
DROP INDEX "sla_violations_rule_idx";--> statement-breakpoint
DROP INDEX "freshdesk_tickets_linked_jira_idx";--> statement-breakpoint
DROP INDEX "freshdesk_tickets_project_fd_id_idx";--> statement-breakpoint
DROP INDEX "freshdesk_tickets_project_idx";--> statement-breakpoint
DROP INDEX "freshdesk_tickets_status_idx";--> statement-breakpoint
DROP INDEX "calendar_events_ical_uid_idx";--> statement-breakpoint
DROP INDEX "calendar_events_user_event_idx";--> statement-breakpoint
DROP INDEX "calendar_events_user_starts_idx";--> statement-breakpoint
DROP INDEX "user_integrations_user_idx";--> statement-breakpoint
DROP INDEX "user_integrations_user_provider_idx";--> statement-breakpoint
ALTER TABLE "jira_issues" ALTER COLUMN "labels" SET DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "jira_issues" ALTER COLUMN "additional_assignee_emails" SET DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "jira_sync_jobs" ALTER COLUMN "error_messages" SET DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "sla_rules" ALTER COLUMN "additional_emails" SET DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "calendar_events" ALTER COLUMN "attendee_emails" SET DEFAULT '{}'::text[];--> statement-breakpoint
CREATE INDEX "feature_requests_created_at_idx" ON "feature_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "feature_requests_priority_idx" ON "feature_requests" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "feature_requests_submitted_by_idx" ON "feature_requests" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX "jira_issues_additional_assignees_gin_idx" ON "jira_issues" USING gin ("additional_assignee_emails");--> statement-breakpoint
CREATE INDEX "jira_issues_assignee_email_idx" ON "jira_issues" USING btree ("assignee_email");--> statement-breakpoint
CREATE INDEX "jira_issues_completed_at_idx" ON "jira_issues" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX "jira_issues_jira_key_idx" ON "jira_issues" USING btree ("jira_key");--> statement-breakpoint
CREATE UNIQUE INDEX "jira_issues_project_jira_id_idx" ON "jira_issues" USING btree ("project_id","jira_id");--> statement-breakpoint
CREATE INDEX "jira_issues_project_updated_idx" ON "jira_issues" USING btree ("project_id","jira_updated_at");--> statement-breakpoint
CREATE INDEX "jira_issues_reporter_email_idx" ON "jira_issues" USING btree ("reporter_email");--> statement-breakpoint
CREATE INDEX "jira_issues_status_idx" ON "jira_issues" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "jira_projects_base_url_key_idx" ON "jira_projects" USING btree ("jira_base_url","jira_project_key");--> statement-breakpoint
CREATE INDEX "jira_sync_jobs_project_idx" ON "jira_sync_jobs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "jira_sync_jobs_status_idx" ON "jira_sync_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "observer_board_members_board_email_idx" ON "observer_board_members" USING btree ("board_id","email");--> statement-breakpoint
CREATE INDEX "observer_board_members_board_idx" ON "observer_board_members" USING btree ("board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_stakeholders_project_email_idx" ON "project_stakeholders" USING btree ("project_id","email");--> statement-breakpoint
CREATE INDEX "project_stakeholders_project_idx" ON "project_stakeholders" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_status_mappings_project_idx" ON "project_status_mappings" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_status_mappings_project_raw_idx" ON "project_status_mappings" USING btree ("project_id","raw_status");--> statement-breakpoint
CREATE INDEX "requirements_created_by_idx" ON "requirements" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "requirements_project_idx" ON "requirements" USING btree ("jira_project_id");--> statement-breakpoint
CREATE INDEX "requirements_repo_idx" ON "requirements" USING btree ("github_repo_name");--> statement-breakpoint
CREATE INDEX "requirements_status_idx" ON "requirements" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "sla_violations_active_idx" ON "sla_violations" USING btree ("rule_id","issue_id") WHERE resolved_at IS NULL;--> statement-breakpoint
CREATE INDEX "sla_violations_issue_idx" ON "sla_violations" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "sla_violations_rule_idx" ON "sla_violations" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "freshdesk_tickets_linked_jira_idx" ON "freshdesk_tickets" USING btree ("linked_jira_issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "freshdesk_tickets_project_fd_id_idx" ON "freshdesk_tickets" USING btree ("project_id","fd_ticket_id");--> statement-breakpoint
CREATE INDEX "freshdesk_tickets_project_idx" ON "freshdesk_tickets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "freshdesk_tickets_status_idx" ON "freshdesk_tickets" USING btree ("fd_status");--> statement-breakpoint
CREATE INDEX "calendar_events_ical_uid_idx" ON "calendar_events" USING btree ("ical_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_user_event_idx" ON "calendar_events" USING btree ("user_id","google_event_id");--> statement-breakpoint
CREATE INDEX "calendar_events_user_starts_idx" ON "calendar_events" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX "user_integrations_user_idx" ON "user_integrations" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_integrations_user_provider_idx" ON "user_integrations" USING btree ("user_id","provider");