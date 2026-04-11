CREATE TYPE "public"."canonical_status" AS ENUM('BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'IN_QA', 'DONE', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "project_status_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"raw_status" text NOT NULL,
	"canonical_status" "canonical_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_status_mappings" ADD CONSTRAINT "project_status_mappings_project_id_jira_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."jira_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_status_mappings_project_raw_idx" ON "project_status_mappings" USING btree ("project_id","raw_status");--> statement-breakpoint
CREATE INDEX "project_status_mappings_project_idx" ON "project_status_mappings" USING btree ("project_id");