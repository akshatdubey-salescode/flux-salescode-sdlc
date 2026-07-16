CREATE TYPE "public"."delay_reason_category" AS ENUM('leave', 'third_party_dependency', 'person_dependency', 'dev_delay', 'qa_delay', 'resource_unavailability', 'env_unavailability', 'other_project_task', 'other_project_bug', 'estimate_low', 'other');--> statement-breakpoint
CREATE TABLE "delay_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"category" "delay_reason_category" NOT NULL,
	"delay_date" date NOT NULL,
	"responsible_email" text,
	"responsible_name" text,
	"note" text,
	"linked_project_id" uuid,
	"linked_issue_id" uuid,
	"logged_by" text NOT NULL,
	"logged_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delay_logs" ADD CONSTRAINT "delay_logs_issue_id_jira_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."jira_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delay_logs" ADD CONSTRAINT "delay_logs_project_id_jira_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."jira_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delay_logs" ADD CONSTRAINT "delay_logs_linked_project_id_jira_projects_id_fk" FOREIGN KEY ("linked_project_id") REFERENCES "public"."jira_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delay_logs" ADD CONSTRAINT "delay_logs_linked_issue_id_jira_issues_id_fk" FOREIGN KEY ("linked_issue_id") REFERENCES "public"."jira_issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delay_logs" ADD CONSTRAINT "delay_logs_logged_by_users_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delay_logs_issue_idx" ON "delay_logs" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "delay_logs_project_idx" ON "delay_logs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "delay_logs_responsible_idx" ON "delay_logs" USING btree ("responsible_email");--> statement-breakpoint
CREATE INDEX "delay_logs_category_idx" ON "delay_logs" USING btree ("category");