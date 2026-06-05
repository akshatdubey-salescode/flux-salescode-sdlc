ALTER TABLE "jira_projects" DROP COLUMN "multi_assignee_field_id";--> statement-breakpoint
ALTER TABLE "jira_projects" ADD COLUMN "multi_assignee_field_ids" text[];