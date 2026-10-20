CREATE TABLE "tc_project_folders" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"folder" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tc_files" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "tc_rounds" ADD COLUMN "source_hash" text;--> statement-breakpoint
ALTER TABLE "tc_project_folders" ADD CONSTRAINT "tc_project_folders_project_id_jira_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."jira_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tc_project_folders_folder_idx" ON "tc_project_folders" USING btree ("folder");--> statement-breakpoint
CREATE INDEX "tc_rounds_source_hash_idx" ON "tc_rounds" USING btree ("source_hash");