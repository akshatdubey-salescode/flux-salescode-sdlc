ALTER TABLE "jira_issues" ADD COLUMN "dev_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jira_issues" ADD COLUMN "dev_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jira_projects" ADD COLUMN "actual_start_field_ids" text[];--> statement-breakpoint
ALTER TABLE "jira_projects" ADD COLUMN "actual_end_field_ids" text[];