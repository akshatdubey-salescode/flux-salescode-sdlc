CREATE TYPE "public"."jira_assignee_to_kind" AS ENUM('unassigned', 'reporter', 'other');--> statement-breakpoint
CREATE TABLE "jira_assignee_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"changelog_history_id" text NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"author_account_id" text,
	"author_email" text,
	"author_name" text,
	"from_account_id" text,
	"from_email" text,
	"from_name" text,
	"to_account_id" text,
	"to_email" text,
	"to_name" text,
	"is_self_removal" boolean DEFAULT false NOT NULL,
	"to_kind" "jira_assignee_to_kind" DEFAULT 'other' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jira_issues" ADD COLUMN "assignee_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jira_assignee_changes" ADD CONSTRAINT "jira_assignee_changes_issue_id_jira_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."jira_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jira_assignee_changes" ADD CONSTRAINT "jira_assignee_changes_project_id_jira_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."jira_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jira_assignee_changes_issue_history_idx" ON "jira_assignee_changes" USING btree ("issue_id","changelog_history_id");--> statement-breakpoint
CREATE INDEX "jira_assignee_changes_self_removal_idx" ON "jira_assignee_changes" USING btree ("is_self_removal","changed_at");--> statement-breakpoint
CREATE INDEX "jira_assignee_changes_author_idx" ON "jira_assignee_changes" USING btree ("author_account_id","changed_at");--> statement-breakpoint
CREATE INDEX "jira_assignee_changes_project_idx" ON "jira_assignee_changes" USING btree ("project_id");