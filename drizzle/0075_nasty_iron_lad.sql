CREATE TABLE "sprint_workstreams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" text NOT NULL,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sprints" ADD COLUMN "workstream_id" uuid;--> statement-breakpoint
ALTER TABLE "sprint_workstreams" ADD CONSTRAINT "sprint_workstreams_project_id_jira_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."jira_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_workstreams" ADD CONSTRAINT "sprint_workstreams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sprint_workstreams_project_idx" ON "sprint_workstreams" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_workstream_id_sprint_workstreams_id_fk" FOREIGN KEY ("workstream_id") REFERENCES "public"."sprint_workstreams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sprints_workstream_idx" ON "sprints" USING btree ("workstream_id");