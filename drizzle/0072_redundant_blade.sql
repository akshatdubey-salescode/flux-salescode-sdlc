CREATE TABLE "sprint_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sprint_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"added_by" text NOT NULL,
	"added_by_name" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"carried_from_sprint_id" uuid,
	"carried_from_sprint_name" text
);
--> statement-breakpoint
CREATE TABLE "sprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"goal" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_by" text NOT NULL,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_by_name" text,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"completed_by_name" text
);
--> statement-breakpoint
ALTER TABLE "sprint_items" ADD CONSTRAINT "sprint_items_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_items" ADD CONSTRAINT "sprint_items_issue_id_jira_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."jira_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_items" ADD CONSTRAINT "sprint_items_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_items" ADD CONSTRAINT "sprint_items_carried_from_sprint_id_sprints_id_fk" FOREIGN KEY ("carried_from_sprint_id") REFERENCES "public"."sprints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_project_id_jira_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."jira_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sprint_items_sprint_issue_idx" ON "sprint_items" USING btree ("sprint_id","issue_id");--> statement-breakpoint
CREATE INDEX "sprint_items_sprint_idx" ON "sprint_items" USING btree ("sprint_id");--> statement-breakpoint
CREATE INDEX "sprint_items_issue_idx" ON "sprint_items" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "sprints_project_idx" ON "sprints" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "sprints_dates_idx" ON "sprints" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX "sprints_active_idx" ON "sprints" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "sprints_completed_idx" ON "sprints" USING btree ("completed_at");