ALTER TABLE "jira_issues" ADD COLUMN "additional_assignee_emails" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "jira_projects" ADD COLUMN "multi_assignee_field_id" text;--> statement-breakpoint
CREATE INDEX "jira_issues_additional_assignees_gin_idx" ON "jira_issues" USING gin ("additional_assignee_emails");