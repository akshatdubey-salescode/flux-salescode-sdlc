CREATE TABLE "jira_sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_issues" integer,
	"synced_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"error_messages" text[] DEFAULT '{}'::text[] NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jira_sync_jobs" ADD CONSTRAINT "jira_sync_jobs_project_id_jira_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."jira_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jira_sync_jobs_project_idx" ON "jira_sync_jobs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "jira_sync_jobs_status_idx" ON "jira_sync_jobs" USING btree ("status");