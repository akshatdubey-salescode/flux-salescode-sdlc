DROP INDEX "tc_ai_knowledge_project_page_idx";--> statement-breakpoint
ALTER TABLE "tc_ai_knowledge_pages" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tc_ai_knowledge_pages" ADD COLUMN "credentials_project_id" uuid;--> statement-breakpoint
ALTER TABLE "tc_ai_knowledge_pages" ADD CONSTRAINT "tc_ai_knowledge_pages_credentials_project_id_jira_projects_id_fk" FOREIGN KEY ("credentials_project_id") REFERENCES "public"."jira_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tc_ai_knowledge_shared_page_idx" ON "tc_ai_knowledge_pages" USING btree ("page_id") WHERE "tc_ai_knowledge_pages"."project_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "tc_ai_knowledge_project_page_idx" ON "tc_ai_knowledge_pages" USING btree ("project_id","page_id") WHERE "tc_ai_knowledge_pages"."project_id" is not null;